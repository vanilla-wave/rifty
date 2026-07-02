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
 *       silently skipped — the item's contract). When `VITE_RIFTY_RESOLVER_URL`
 *       is ALSO set, (b) runs TWO passes on the same port — a standard baseline
 *       (no resolver) then the eddy fast path — and records the eddy median as
 *       the headline number with the standard baseline + measured `speedupX`
 *       nested under it (the resolver is baked per dev server, so it takes two).
 *
 * Usage: node tools/perf/bench.mjs [--runs N] [--out path]
 *   RIFTY_PLAYGROUND_PORT  isolate the dev-server port (default 5390)
 *   VITE_RIFTY_REGISTRY_URL  enables (b), routes install at the live proxy
 *   VITE_RIFTY_RESOLVER_URL  adds the eddy fast-path pass + speedup vs baseline
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
// One discarded warm-up run per install pass: the FIRST run pays a one-off
// cost (dev-server module graph, registry-proxy/eddy connection) that a
// deployed, warm server never re-pays, so it would skew the install median
// (esp. the standard baseline, whose packument waterfall is latency-bound). The
// deep-link cold-start (a) is measured on the real runs, unaffected.
const WARMUP = 1;
const OUT = resolve(REPO_ROOT, argVal('--out', 'perf/benchmarks.json'));
const PORT = Number(process.env.RIFTY_PLAYGROUND_PORT ?? '5390');
const REGISTRY_URL = process.env.VITE_RIFTY_REGISTRY_URL; // D-004 — enables (b)
const RESOLVER_URL = process.env.VITE_RIFTY_RESOLVER_URL; // optional eddy fast path
const BASE = `http://localhost:${PORT}`;
const DEEP_LINK = `${BASE}/?preset=real-vite&autorun=1`;

const DEV_READY_TIMEOUT = 90_000;
const INTERACTIVE_TIMEOUT = 45_000;
const INSTALL_TIMEOUT = 180_000;

// Instant presets for the pick→preview-live metric (`--presets none` skips the
// phase — recorded in the artifact, never silent). typescript-ls exercises the
// esbuild-WASI transform path; project-files is the plain-JS floor.
const PRESETS_ARG = argVal('--presets', 'project-files,typescript-ls');
const PRESET_IDS = PRESETS_ARG === 'none' ? [] : PRESETS_ARG.split(',').filter(Boolean);
const PRESET_BOOT_TIMEOUT = 120_000;

// Attribution stages from markers the boot already paints into the page
// terminal. Only PAGE-observable markers qualify — the dev-server child's
// other log lines ("importing vite…", "listening on internal port") never
// reach the page terminal buffer. A missing marker records null, never a guess.
const PRESET_STAGE_MARKERS = [['viteReadyMs', /\[vite\] dev server ready on port/]];

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

/**
 * Fail fast if the strict port is already serving: `pnpm dev` uses strictPort, so
 * a stale/foreign server on this port makes the spawned dev server crash on bind
 * while `waitForHttp` happily measures the WRONG server (the stale-port trap).
 * The harness OWNS its port — an occupied one is an operator error, not a result.
 */
async function assertPortFree() {
  try {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    if (res.status > 0) {
      throw new Error(
        `port ${PORT} is already serving (a stale/foreign dev server?) — the harness would measure it, not a fresh one. Kill it or set a unique RIFTY_PLAYGROUND_PORT.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already serving')) throw err;
    /* connection refused → port free, good */
  }
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

function startDevServer(withResolver) {
  const env = { ...process.env, RIFTY_PLAYGROUND_PORT: String(PORT) };
  if (REGISTRY_URL) env.VITE_RIFTY_REGISTRY_URL = REGISTRY_URL;
  // The resolver is baked into the dev bundle at transform time, so the eddy vs
  // standard baseline needs two dev servers. Delete (not just omit) it for the
  // baseline pass so an inherited value can't leak the eddy path into it.
  if (withResolver && RESOLVER_URL) env.VITE_RIFTY_RESOLVER_URL = RESOLVER_URL;
  // biome-ignore lint/performance/noDelete: strip an inherited resolver so the baseline pass's dev server truly lacks the eddy fast path (not a hot loop — a one-shot spawn).
  else delete env.VITE_RIFTY_RESOLVER_URL;
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

/**
 * One measurement pass against a freshly-spawned dev server (its own resolver
 * bake). Kills the dev-server group on the way out so the strict port is free
 * for the next pass. Returns the run's cold + install samples.
 */
async function runPhase(browser, label, withResolver, measureInstall) {
  const dev = startDevServer(withResolver);
  const cold = [];
  const install = [];
  let installError = null;
  try {
    await waitForHttp(`${BASE}/`, DEV_READY_TIMEOUT);
    // Our spawned dev server must be the one that answered. If it already exited
    // (strictPort bind lost to a server that slipped onto the port), we'd be
    // measuring a foreign responder — refuse rather than publish a wrong number.
    if (dev.exitCode !== null || dev.signalCode !== null) {
      throw new Error(
        `[${label}] dev server exited (code ${dev.exitCode}, signal ${dev.signalCode}) before serving on port ${PORT} — refusing to measure a foreign responder.`,
      );
    }
    // Warm the shared server + proxy once (discarded) so the measured install
    // samples are steady-state, not first-hit. Only when install is measured —
    // a cold-only pass (no proxy, e.g. CI smoke) needs no warm-up.
    if (measureInstall) {
      for (let w = 0; w < WARMUP; w++) {
        const wr = await runOnce(browser, measureInstall);
        console.log(
          `  [${label}] warmup ${w + 1}/${WARMUP}: cold=${wr.coldMs}ms${wr.installMs != null ? ` install=${wr.installMs}ms` : wr.installError ? ` install=FAILED (${wr.installError})` : ''} (discarded)`,
        );
      }
    }
    for (let i = 0; i < RUNS; i++) {
      const r = await runOnce(browser, measureInstall);
      cold.push(r.coldMs);
      if (r.installMs != null) install.push(r.installMs);
      else if (r.installError) installError = r.installError;
      console.log(
        `  [${label}] run ${i + 1}/${RUNS}: cold=${r.coldMs}ms${r.installMs != null ? ` install=${r.installMs}ms` : r.installError ? ` install=FAILED (${r.installError})` : ''}`,
      );
    }
  } finally {
    stopDevServer(dev);
    await sleep(1_000); // let the strict port free before the next pass spawns
  }
  return { cold, install, installError };
}

async function runPresetBootOnce(browser, presetId) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // The deep-link silently falls back to the DEFAULT preset on an unknown id
    // (with a console.warn) — a typo'd --presets would measure the wrong boot
    // under the requested name. Surface the warn as a loud failure instead.
    let unknownPresetWarn = null;
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('unknown preset') && text.includes('?preset=')) unknownPresetWarn = text;
    });
    const t0 = Date.now();
    await page.goto(`${BASE}/?preset=${presetId}&autorun=1`, { waitUntil: 'commit' });
    await page.waitForFunction(interactivePredicate, null, { timeout: INTERACTIVE_TIMEOUT });
    const stages = { interactiveMs: Date.now() - t0 };
    const pending = new Map(PRESET_STAGE_MARKERS);
    const deadline = t0 + PRESET_BOOT_TIMEOUT;
    while (Date.now() < deadline) {
      if (unknownPresetWarn) {
        throw new Error(`[${presetId}] not a known preset (${unknownPresetWarn})`);
      }
      const text = (await terminalText(page)).replace(ANSI_SGR, '');
      // presetBootToPreviewLiveMs promises an INSTANT boot (baked snapshot, no
      // npm install in the path). A from-scratch preset echoes `npm install` in
      // its boot line — measuring it here would lie about the metric.
      if (/\$ [^\n]*npm install/.test(text)) {
        throw new Error(
          `[${presetId}] boot ran npm install — a from-scratch preset cannot be measured as presetBootToPreviewLiveMs (instant presets only)`,
        );
      }
      for (const [key, re] of pending) {
        if (re.test(text)) {
          stages[key] = Date.now() - t0;
          pending.delete(key);
        }
      }
      const live = await page.evaluate(
        () => document.querySelector('.rf-preview__status[data-phase="live"]') !== null,
      );
      if (live) {
        const liveMs = Date.now() - t0;
        // Harness-level false-live guard (independent of the app's warmup fix):
        // LIVE must mean the preview DOCUMENT answers ok — the SW serves an
        // honest 503 error page that still commits into the iframe, and a
        // measurement of that page would be a launch-citable lie. Runs after
        // the sample is taken, so it never inflates the number.
        const doc = await page.evaluate(async () => {
          const el = document.querySelector('[data-testid="preview"] iframe');
          const url = el?.src;
          if (!url) return { ok: false, note: 'no preview iframe src' };
          try {
            const res = await fetch(url, { cache: 'no-store' });
            return { ok: res.ok, note: `status ${res.status}` };
          } catch (err) {
            return { ok: false, note: String(err) };
          }
        });
        if (!doc.ok) {
          throw new Error(
            `[${presetId}] preview reported LIVE but its document is not ok (${doc.note}) — refusing a false-live measurement`,
          );
        }
        // One final scan: a marker's terminal PAINT can lag preview-live by a
        // beat (the preview probe races the pty chunk); its cause precedes live,
        // so a marker visible now is real — anything still missing is null.
        const finalText = (await terminalText(page)).replace(ANSI_SGR, '');
        for (const [key, re] of pending) {
          stages[key] = re.test(finalText) ? Date.now() - t0 : null;
        }
        return { pickToPreviewLiveMs: liveMs, stages };
      }
      await sleep(100);
    }
    throw new Error(`[${presetId}] preview never reached live within ${PRESET_BOOT_TIMEOUT}ms`);
  } finally {
    await context.close();
  }
}

/** Instant-preset pick→preview-live pass (no npm install in the path); its own
 * dev server, same port-ownership rules as the install passes. All RUNS must go
 * live or the preset records `unmeasured` (no partial medians — Fidelity). */
async function runPresetBootPhase(browser) {
  if (PRESET_IDS.length === 0) return { status: 'skipped', note: '--presets none' };
  const dev = startDevServer(false);
  const out = [];
  try {
    await waitForHttp(`${BASE}/`, DEV_READY_TIMEOUT);
    if (dev.exitCode !== null || dev.signalCode !== null) {
      throw new Error(
        `[preset-boot] dev server exited (code ${dev.exitCode}, signal ${dev.signalCode}) before serving on port ${PORT} — refusing to measure a foreign responder.`,
      );
    }
    for (const presetId of PRESET_IDS) {
      try {
        // One discarded warm-up: the first pass pays dev-server transform-cache
        // fills a warm deployment never re-pays. The host dev server's first-hit
        // dep-optimize can even RELOAD the page mid-warmup (destroyed evaluate
        // context) — exactly the first-hit cost warmup absorbs, so the discarded
        // run retries once. Measured runs never retry.
        for (let w = 0; w < WARMUP; w++) {
          let r;
          try {
            r = await runPresetBootOnce(browser, presetId);
          } catch (err) {
            console.log(
              `  [preset ${presetId}] warmup interrupted (${err instanceof Error ? err.message : err}) — retrying the discarded run once`,
            );
            r = await runPresetBootOnce(browser, presetId);
          }
          console.log(`  [preset ${presetId}] warmup: live=${r.pickToPreviewLiveMs}ms (discarded)`);
        }
        const samples = [];
        const stageRuns = [];
        for (let i = 0; i < RUNS; i++) {
          const r = await runPresetBootOnce(browser, presetId);
          samples.push(r.pickToPreviewLiveMs);
          stageRuns.push(r.stages);
          console.log(
            `  [preset ${presetId}] run ${i + 1}/${RUNS}: live=${r.pickToPreviewLiveMs}ms interactive=${r.stages.interactiveMs}ms viteReady=${r.stages.viteReadyMs ?? 'n/a'}ms`,
          );
        }
        out.push({ presetId, samples, stageRuns });
      } catch (err) {
        out.push({
          presetId,
          status: 'unmeasured',
          note: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    stopDevServer(dev);
    await sleep(1_000);
  }
  return out;
}

function measuredOrUnmeasured(samples, error) {
  // All `RUNS` must succeed — a partial set is not a median of N (Fidelity).
  return samples.length === RUNS
    ? { samples }
    : {
        note: `proxy ${REGISTRY_URL} configured but only ${samples.length}/${RUNS} runs reached first Vite response — refusing a partial median${error ? `: ${error}` : ''}`,
      };
}

async function main() {
  const measureInstall = Boolean(REGISTRY_URL);
  const measureEddy = measureInstall && Boolean(RESOLVER_URL);
  console.log(
    `bench: ${RUNS} run(s), port ${PORT}, install ${measureInstall ? `via ${REGISTRY_URL}` : 'SKIPPED (no VITE_RIFTY_REGISTRY_URL → requires proxy)'}${measureEddy ? ` — standard baseline + eddy fast path (${RESOLVER_URL})` : ''}`,
  );
  let browser;
  try {
    await assertPortFree();
    browser = await chromium.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });

    let coldSamples;
    let installMetric;
    if (measureEddy) {
      // Two passes on the same port: standard (no resolver) then eddy. Cold-start
      // is resolver-independent — report the eddy pass's samples.
      const base = await runPhase(browser, 'standard', false, true);
      const eddy = await runPhase(browser, 'eddy', true, true);
      coldSamples = eddy.cold;
      // Both passes must yield ALL `RUNS` samples — a median of N means N runs,
      // not "whatever survived". A partial set is recorded `unmeasured` (never a
      // launch-citable thin median), the item's Fidelity contract.
      if (eddy.install.length === RUNS && base.install.length === RUNS) {
        installMetric = {
          status: 'measured',
          samples: eddy.install,
          baselineSamples: base.install,
          registryUrl: REGISTRY_URL,
          resolverUrl: RESOLVER_URL,
        };
      } else {
        installMetric = {
          status: 'unmeasured',
          note: `proxy ${REGISTRY_URL} + resolver ${RESOLVER_URL} configured but only standard ${base.install.length}/${RUNS} + eddy ${eddy.install.length}/${RUNS} runs reached first Vite response — refusing a partial median${eddy.installError ? ` (eddy: ${eddy.installError})` : base.installError ? ` (standard: ${base.installError})` : ''}`,
        };
      }
    } else if (measureInstall) {
      const std = await runPhase(browser, 'standard', false, true);
      coldSamples = std.cold;
      const m = measuredOrUnmeasured(std.install, std.installError);
      installMetric = m.samples
        ? { status: 'measured', samples: m.samples, registryUrl: REGISTRY_URL }
        : { status: 'unmeasured', note: m.note };
    } else {
      const coldOnly = await runPhase(browser, 'cold', false, false);
      coldSamples = coldOnly.cold;
      installMetric = { status: 'requires proxy' };
    }

    const presetBoot = await runPresetBootPhase(browser);

    const artifact = buildArtifact({
      generatedAt: new Date().toISOString(),
      runs: RUNS,
      coldStartSamples: coldSamples,
      install: installMetric,
      presetBoot,
    });

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`\nartifact → ${OUT}\n${JSON.stringify(artifact.metrics, null, 2)}`);
  } finally {
    // Bound the browser teardown so a wedged Chromium can't hang the process
    // (→ CI job timeout); each phase SIGKILLs its own dev-server group.
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(10_000)]);
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
