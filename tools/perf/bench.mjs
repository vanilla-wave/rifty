#!/usr/bin/env node
/**
 * Cold-start + npm-install benchmark harness
 * (docs/backlog/perf/cold-start-and-install-benchmark).
 *
 * A zero-dep timing runner: spawns an ISOLATED playground dev server, drives a
 * headless Chromium tab (Playwright — already a devDep, NOT vitest `bench`,
 * which can't host a real tab + SW + COI) through the
 * `?preset=real-vite&autorun=1` deep-link, median-of-N with a fresh browser
 * context (fresh profile/SW) per run, and writes a JSON artifact a launch
 * figure can cite.
 *
 * Measures:
 *   (a) cold-start-to-interactive ms — ALWAYS (SW controller + storage badge +
 *       terminal, all reached at boot, network-independent).
 *   (b) npm-install-to-first-Vite-response ms — ONLY when a registry proxy is
 *       configured (`VITE_RIFTY_REGISTRY_URL`, D-004), pointing at the deployed
 *       `registry.rifty.dev`; otherwise recorded `requires proxy` (never
 *       silently skipped — the item's contract).
 *
 * Usage: node tools/perf/bench.mjs [--runs N] [--out path]
 *   RIFTY_PLAYGROUND_PORT  isolate the dev-server port (default 5390)
 *   VITE_RIFTY_REGISTRY_URL  enables (b), routes install at the live proxy
 *   VITE_RIFTY_RESOLVER_URL  optional eddy fast-path URL
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildArtifact } from './src/aggregate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const RUNS = Math.max(1, Number(argVal('--runs', '5')));
const OUT = resolve(REPO_ROOT, argVal('--out', 'perf/benchmarks.json'));
const PORT = Number(process.env.RIFTY_PLAYGROUND_PORT ?? '5390');
const REGISTRY_URL = process.env.VITE_RIFTY_REGISTRY_URL; // D-004 — enables (b)
const RESOLVER_URL = process.env.VITE_RIFTY_RESOLVER_URL; // optional eddy fast path
const BASE = `http://localhost:${PORT}`;
const DEEP_LINK = `${BASE}/?preset=real-vite&autorun=1`;

const DEV_READY_TIMEOUT = 90_000;
const INTERACTIVE_TIMEOUT = 45_000;
const INSTALL_TIMEOUT = 180_000;

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page has booted to interactive: SW in control + storage badge painted +
 * a terminal slot present. All reached at boot, before/independent of install. */
function interactivePredicate() {
  return (
    navigator.serviceWorker.controller !== null &&
    document.querySelector('[data-storage-badge]') !== null &&
    document.querySelector('.rf-terminal-slot') !== null
  );
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw new Error(
    `dev server not ready at ${url} after ${timeoutMs}ms: ${lastErr?.message ?? 'timeout'}`,
  );
}

async function terminalText(page) {
  return page.evaluate(() => {
    const el =
      document.querySelector(
        '.rf-terminal-slot[data-active="true"] [data-testid="terminal-buffer"]',
      ) ?? document.querySelector('[data-testid="terminal-buffer"]');
    return el?.getAttribute('data-terminal-buffer') ?? '';
  });
}

async function waitForTerminal(page, regex, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (regex.test((await terminalText(page)).replace(ANSI_SGR, ''))) return;
    await sleep(250);
  }
  throw new Error(`terminal never matched ${regex} within ${timeoutMs}ms`);
}

function startDevServer() {
  const env = { ...process.env, RIFTY_PLAYGROUND_PORT: String(PORT) };
  if (REGISTRY_URL) env.VITE_RIFTY_REGISTRY_URL = REGISTRY_URL;
  if (RESOLVER_URL) env.VITE_RIFTY_RESOLVER_URL = RESOLVER_URL;
  return spawn('pnpm', ['dev'], { cwd: REPO_ROOT, env, stdio: 'inherit', detached: true });
}

function stopDevServer(child) {
  if (child?.pid) {
    // Kill the whole group (pnpm → vite), not just pnpm, so nothing keeps the
    // strict port held for the next run.
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

async function runOnce(browser, measureInstall) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const t0 = Date.now();
    await page.goto(DEEP_LINK, { waitUntil: 'commit' });
    await page.waitForFunction(interactivePredicate, null, { timeout: INTERACTIVE_TIMEOUT });
    const coldMs = Date.now() - t0;

    let installMs = null;
    let installError = null;
    if (measureInstall) {
      // Install starts when the autorun types `npm install`; first Vite response
      // is the dev-server-ready marker the real-vite bootstrap prints. A slow or
      // failed install/vite-boot is recorded, NOT thrown — it must never nuke the
      // already-measured cold-start sample.
      try {
        await waitForTerminal(page, /npm install/, INTERACTIVE_TIMEOUT);
        const tInstall = Date.now();
        await waitForTerminal(page, /\[vite\] dev server ready on port/, INSTALL_TIMEOUT);
        installMs = Date.now() - tInstall;
      } catch (err) {
        installError = err instanceof Error ? err.message : String(err);
      }
    }
    return { coldMs, installMs, installError };
  } finally {
    await context.close();
  }
}

async function main() {
  const measureInstall = Boolean(REGISTRY_URL);
  console.log(
    `bench: ${RUNS} run(s), port ${PORT}, install ${measureInstall ? `via ${REGISTRY_URL}` : 'SKIPPED (no VITE_RIFTY_REGISTRY_URL → requires proxy)'}`,
  );
  const dev = startDevServer();
  let browser;
  try {
    await waitForHttp(`${BASE}/`, DEV_READY_TIMEOUT);
    browser = await chromium.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });

    const cold = [];
    const install = [];
    let installError = null;
    for (let i = 0; i < RUNS; i++) {
      const r = await runOnce(browser, measureInstall);
      cold.push(r.coldMs);
      if (r.installMs != null) install.push(r.installMs);
      else if (r.installError) installError = r.installError;
      console.log(
        `  run ${i + 1}/${RUNS}: cold=${r.coldMs}ms${r.installMs != null ? ` install=${r.installMs}ms` : r.installError ? ` install=FAILED (${r.installError})` : ''}`,
      );
    }

    let installMetric;
    if (!measureInstall) {
      installMetric = { status: 'requires proxy' };
    } else if (install.length > 0) {
      installMetric = { status: 'measured', samples: install, registryUrl: REGISTRY_URL };
    } else {
      installMetric = {
        status: 'unmeasured',
        note: `proxy ${REGISTRY_URL} configured but install did not reach first Vite response${installError ? `: ${installError}` : ''}`,
      };
    }

    const artifact = buildArtifact({
      generatedAt: new Date().toISOString(),
      runs: RUNS,
      coldStartSamples: cold,
      install: installMetric,
    });

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`\nartifact → ${OUT}\n${JSON.stringify(artifact.metrics, null, 2)}`);
  } finally {
    // Bound the browser teardown so a wedged Chromium can't hang the process
    // (→ CI job timeout); the dev-server group is SIGKILLed regardless.
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(10_000)]);
    stopDevServer(dev);
  }
}

// Explicit exit: a lingering browser/dev-server handle must never keep the
// event loop alive past a completed (or failed) run.
main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
