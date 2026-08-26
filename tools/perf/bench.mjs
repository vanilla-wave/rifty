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
 * Usage: node tools/perf/bench.mjs [--runs N] [--out path] [--transport auto|h2|h3|matrix]
 *   RIFTY_PLAYGROUND_PORT  isolate the dev-server port (default 5390)
 *   VITE_RIFTY_REGISTRY_URL  enables (b), routes install at the live proxy
 *   VITE_RIFTY_RESOLVER_URL  adds the eddy fast-path pass + speedup vs baseline
 *   VITE_RIFTY_EDDY_BUNDLE_URL  optional split-host GET tier — probed too
 *
 * Transport matrix (docs/backlog/perf/eddy-http3-cold-validation): `--transport
 * matrix` runs auto+h2+h3 and writes one phase-labelled artifact. h2 PINS with
 * --disable-quic; h3 PINS with --origin-to-force-quic-on and no TCP fallback.
 * Every pinned pass verifies with per-run evidence: measured-window request
 * counts per origin + a post-window CDP protocol probe. A pass whose USED
 * origins lack positive pinned-protocol proof is refused — never a lying median.
 * `auto` (default) records evidence without pinning.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildArtifact, verifyEddyInstallProof, verifyTransportPin } from './src/aggregate.mjs';
import { assertPerfPortFree, publishPerfArtifact } from './src/runner-io.mjs';

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
const BUNDLE_URL = process.env.VITE_RIFTY_EDDY_BUNDLE_URL; // optional split-host GET tier
const BASE = `http://localhost:${PORT}`;
const DEEP_LINK = `${BASE}/?preset=real-vite&autorun=1`;

const TRANSPORT_ARG = argVal('--transport', 'auto');
if (!['auto', 'h2', 'h3', 'matrix'].includes(TRANSPORT_ARG)) {
  console.error(`--transport must be auto|h2|h3|matrix, got ${JSON.stringify(TRANSPORT_ARG)}`);
  process.exit(2);
}
const TRANSPORT_MODES = TRANSPORT_ARG === 'matrix' ? ['auto', 'h2', 'h3'] : [TRANSPORT_ARG];
if (TRANSPORT_MODES.some((mode) => mode !== 'auto') && !REGISTRY_URL) {
  console.error(
    `--transport ${TRANSPORT_ARG} pins the install path's remote origins, but no install pass is configured (set VITE_RIFTY_REGISTRY_URL) — refusing a pin that measures nothing.`,
  );
  process.exit(2);
}
if (TRANSPORT_MODES.includes('h3') && measuredOrigins().length === 0) {
  console.error(
    '--transport h3 needs at least one remote https origin to force QUIC on (VITE_RIFTY_REGISTRY_URL / VITE_RIFTY_RESOLVER_URL are not https URLs).',
  );
  process.exit(2);
}

/** The remote https origins the install path actually rides (registry proxy,
 * eddy resolver, optional split-host bundle tier) — the transport pin +
 * protocol evidence target exactly these. A relative/dev-proxy URL (e.g.
 * `/npm-registry`) is not a remote origin and is excluded. */
function measuredOrigins() {
  const origins = new Set();
  for (const u of [REGISTRY_URL, RESOLVER_URL, BUNDLE_URL]) {
    if (!u) continue;
    try {
      const parsed = new URL(u);
      if (parsed.protocol === 'https:') origins.add(parsed.origin);
    } catch {
      /* relative dev-proxy path → local, not a measured remote origin */
    }
  }
  return [...origins];
}

/** Chromium launch args pinning the transport for the measured origins.
 * `--origin-to-force-quic-on` admits NO TCP fallback — a blocked UDP 443 shows
 * up as `unreachable` evidence (a loud refusal), never a silent h2 number. */
function transportLaunchArgs(mode) {
  if (mode === 'h2') return ['--disable-quic'];
  if (mode === 'h3') {
    const hosts = measuredOrigins().map((o) => {
      const u = new URL(o);
      return `${u.hostname}:${u.port || '443'}`;
    });
    return ['--enable-quic', `--origin-to-force-quic-on=${hosts.join(',')}`];
  }
  return [];
}

const DEV_READY_TIMEOUT = 90_000;
const INTERACTIVE_TIMEOUT = 45_000;
const INSTALL_TIMEOUT = 180_000;

// Instant presets for the pick→preview-live metric (`--presets none` skips the
// phase — recorded in the artifact, never silent). typescript-ls exercises the
// TypeScript-tooling path; project-files is the plain-JS floor.
const PRESETS_ARG = argVal('--presets', 'project-files,typescript-ls');
const PRESET_IDS = PRESETS_ARG === 'none' ? [] : PRESETS_ARG.split(',').filter(Boolean);
const PRESET_BOOT_TIMEOUT = 120_000;

// Attribution stages from markers the boot already paints into the page
// terminal. Only PAGE-observable markers qualify — the dev-server child's
// other log lines ("importing vite…", "listening on internal port") never
// reach the page terminal buffer. A missing marker records null, never a guess.
// The rifty-authored `[vite] dev server ready on port` line died with the
// generic dev-server lifecycle (PR #109); the marker is now REAL vite's own
// ready banner — strictly more faithful (it is what Node prints too).
const PRESET_STAGE_MARKERS = [['viteReadyMs', /VITE v[\d.]+\s+ready in \d+ ms/]];

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

/**
 * False-live guard for preview-live metrics: LIVE must mean the preview document
 * answers ok — the SW serves an honest 503 error page that still commits into
 * the iframe, and measuring that would be a launch-citable lie. Bounded; runs
 * AFTER the sample point so it never inflates a measured number.
 */
async function assertPreviewDocumentOk(page, label) {
  const doc = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="preview"] iframe');
    const url = el?.src;
    if (!url) return { ok: false, note: 'no preview iframe src' };
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      return { ok: res.ok, note: `status ${res.status}` };
    } catch (err) {
      return { ok: false, note: String(err) };
    }
  });
  if (!doc.ok) {
    throw new Error(
      `${label} preview reported LIVE but its document is not ok (${doc.note}) — refusing a false-live measurement`,
    );
  }
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

/**
 * Post-window protocol probe for the measured origins: a page-context probe
 * fetch per origin, protocol read via CDP `Network.responseReceived`
 * (resource-timing's `nextHopProtocol` is TAO-gated cross-origin — useless
 * here). Combined with the measured-window per-origin REQUEST COUNTS this is
 * per-request-grade evidence under a pin: `--origin-to-force-quic-on` admits
 * no TCP and `--disable-quic` admits no QUIC (browser-global), so requests
 * that succeeded during the window rode the pinned class, and the probe
 * supplies the POSITIVE protocol proof (the page shares the context's socket
 * pools with the install worker). It runs AFTER the sample window — it never
 * primes connections the install would reuse, and never inflates the number.
 * `unreachable` = the probe could not connect at all (e.g. QUIC forced but
 * UDP 443 blocked end-to-end). Under `auto` the probe is end-of-run
 * connection-class evidence only (no per-request claim — recorded as such).
 */
async function probeOriginProtocols(page) {
  const origins = measuredOrigins();
  if (origins.length === 0) return null;
  const cdp = await page.context().newCDPSession(page);
  const seen = new Map();
  cdp.on('Network.responseReceived', (e) => {
    try {
      const origin = new URL(e.response.url).origin;
      if (origins.includes(origin) && !seen.has(origin)) {
        seen.set(origin, e.response.protocol ?? 'unknown');
      }
    } catch {
      /* data:/blob: URLs → not a measured origin */
    }
  });
  try {
    await cdp.send('Network.enable');
    for (const origin of origins) {
      // The probe itself is bounded (its own axis): the in-page fetch aborts
      // at 3s and the evaluate is raced at 5s — a forced-QUIC blackhole origin
      // records `unreachable` instead of hanging the harness.
      await Promise.race([
        page.evaluate(
          (u) =>
            fetch(u, { cache: 'no-store', signal: AbortSignal.timeout(3_000) }).then(
              () => undefined,
              () => undefined,
            ),
          `${origin}/`,
        ),
        sleep(5_000),
      ]);
    }
    // responseReceived races the fetch settle — poll briefly for stragglers.
    const deadline = Date.now() + 3_000;
    while (seen.size < origins.length && Date.now() < deadline) await sleep(50);
  } finally {
    await cdp.detach().catch(() => {});
  }
  return Object.fromEntries(origins.map((o) => [o, seen.get(o) ?? 'unreachable']));
}

async function runOnce(browser, measureInstall, expectEddyFastPath = false) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Measured-window request counts per measured origin (worker fetches are
    // visible on page request events): which origins the sample actually rode
    // — the enforcement scope for the transport pin. Counting stops when the
    // sample window closes so the post-window probe never counts itself.
    const origins = measuredOrigins();
    const requestCounts = new Map();
    let windowOpen = true;
    if (measureInstall && origins.length > 0) {
      page.on('request', (req) => {
        if (!windowOpen) return;
        try {
          const origin = new URL(req.url()).origin;
          if (origins.includes(origin)) {
            requestCounts.set(origin, (requestCounts.get(origin) ?? 0) + 1);
          }
        } catch {
          /* data:/blob: URLs */
        }
      });
    }
    const t0 = Date.now();
    await page.goto(DEEP_LINK, { waitUntil: 'commit' });
    await page.waitForFunction(interactivePredicate, null, { timeout: INTERACTIVE_TIMEOUT });
    const coldMs = Date.now() - t0;

    let installMs = null;
    let installError = null;
    let transportEvidence = null;
    if (measureInstall) {
      // Install starts when the autorun types `npm install`; first Vite response
      // is real vite's own ready banner (the rifty-authored ready line died with
      // the generic dev-server lifecycle, PR #109). A slow or failed
      // install/vite-boot is recorded, NOT thrown — it must never nuke the
      // already-measured cold-start sample.
      try {
        await waitForTerminal(page, /npm install/, INTERACTIVE_TIMEOUT);
        const tInstall = Date.now();
        await waitForTerminal(page, /VITE v[\d.]+\s+ready in \d+ ms/, INSTALL_TIMEOUT);
        const viteReadyAt = Date.now();
        if (expectEddyFastPath) {
          const proof = verifyEddyInstallProof((await terminalText(page)).replace(ANSI_SGR, ''));
          if (!proof.ok) throw new Error(proof.note);
        }
        installMs = viteReadyAt - tInstall;
      } catch (err) {
        installError = err instanceof Error ? err.message : String(err);
      }
      windowOpen = false;
      // Probe runs AFTER the sample window — it never inflates the number.
      const protocols = await probeOriginProtocols(page).catch(() =>
        Object.fromEntries(origins.map((o) => [o, 'unreachable'])),
      );
      if (protocols) {
        transportEvidence = Object.fromEntries(
          origins.map((o) => [
            o,
            { protocol: protocols[o] ?? 'unreachable', requests: requestCounts.get(o) ?? 0 },
          ]),
        );
      }
    }
    return { coldMs, installMs, installError, transportEvidence };
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
  const transportRuns = [];
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
        const wr = await runOnce(browser, measureInstall, withResolver);
        console.log(
          `  [${label}] warmup ${w + 1}/${WARMUP}: cold=${wr.coldMs}ms${wr.installMs != null ? ` install=${wr.installMs}ms` : wr.installError ? ` install=FAILED (${wr.installError})` : ''} (discarded)`,
        );
      }
    }
    for (let i = 0; i < RUNS; i++) {
      const r = await runOnce(browser, measureInstall, withResolver);
      cold.push(r.coldMs);
      if (r.installMs != null) install.push(r.installMs);
      else if (r.installError) installError = r.installError;
      if (r.transportEvidence) transportRuns.push(r.transportEvidence);
      console.log(
        `  [${label}] run ${i + 1}/${RUNS}: cold=${r.coldMs}ms${r.installMs != null ? ` install=${r.installMs}ms` : r.installError ? ` install=FAILED (${r.installError})` : ''}${r.transportEvidence ? ` transport=${JSON.stringify(r.transportEvidence)}` : ''}`,
      );
    }
  } finally {
    stopDevServer(dev);
    await sleep(1_000); // let the strict port free before the next pass spawns
  }
  return { cold, install, installError, transportRuns };
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
        await assertPreviewDocumentOk(page, `[${presetId}]`);
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

/** Merge per-run transport evidence across passes into the artifact's
 * transport record: `originProtocols` (unique probed protocols per origin —
 * the summary) + `runs` (the verbatim per-run `{ origin: { protocol,
 * requests } }` audit list — which transport each sample actually rode).
 * Returns `record: undefined` when there is no evidence (local-only run) —
 * callers then omit the metric's `transport` key. */
function summarizeTransportPhase(mode, phase) {
  const runsEvidence = phase.transportRuns;
  if (runsEvidence.length === 0) return { record: undefined, runsEvidence };
  const perOrigin = {};
  for (const rec of runsEvidence) {
    for (const [origin, evidence] of Object.entries(rec)) {
      const seen = perOrigin[origin] ?? new Set();
      perOrigin[origin] = seen;
      seen.add(evidence.protocol);
    }
  }
  const record = {
    mode,
    originProtocols: Object.fromEntries(
      Object.entries(perOrigin).map(([o, s]) => [o, [...s].sort()]),
    ),
    runs: runsEvidence,
  };
  return { record, runsEvidence };
}

function measuredOrUnmeasured(samples, error) {
  // All `RUNS` must succeed — a partial set is not a median of N (Fidelity).
  return samples.length === RUNS
    ? { samples }
    : {
        note: `proxy ${REGISTRY_URL} configured but only ${samples.length}/${RUNS} runs reached first Vite response — refusing a partial median${error ? `: ${error}` : ''}`,
      };
}

function phaseMetric(mode, phase, label, urlFields, pin) {
  const { record, runsEvidence } = summarizeTransportPhase(mode, phase);
  const verifiedPin = pin ?? verifyTransportPin(mode, runsEvidence);
  if (!verifiedPin.ok) {
    return {
      status: 'unmeasured',
      note: verifiedPin.note,
      ...urlFields,
      ...(record ? { transport: record } : {}),
    };
  }
  const measured = measuredOrUnmeasured(phase.install, phase.installError);
  return measured.samples
    ? {
        status: 'measured',
        samples: measured.samples,
        ...urlFields,
        ...(record ? { transport: record } : {}),
      }
    : {
        status: 'unmeasured',
        note: `${label}: ${measured.note}`,
        ...urlFields,
        ...(record ? { transport: record } : {}),
      };
}

function installMetricFromRow(mode, row) {
  if (row.eddy) {
    if (row.standard.status === 'measured' && row.eddy.status === 'measured') {
      return {
        status: 'measured',
        samples: row.eddy.samples,
        baselineSamples: row.standard.samples,
        registryUrl: REGISTRY_URL,
        resolverUrl: RESOLVER_URL,
        ...(row.eddy.transport ? { transport: row.eddy.transport } : {}),
        ...(row.standard.transport ? { baselineTransport: row.standard.transport } : {}),
      };
    }
    const notes = [];
    if (row.standard.status !== 'measured') notes.push(`standard: ${row.standard.note}`);
    if (row.eddy.status !== 'measured') notes.push(`eddy: ${row.eddy.note}`);
    return {
      status: 'unmeasured',
      note: `transport ${mode} did not produce complete standard+eddy install samples — ${notes.join('; ')}`,
      registryUrl: REGISTRY_URL,
      resolverUrl: RESOLVER_URL,
      ...(row.eddy.transport ? { transport: row.eddy.transport } : {}),
      ...(row.standard.transport ? { baselineTransport: row.standard.transport } : {}),
    };
  }
  if (row.standard.status === 'measured') {
    return {
      status: 'measured',
      samples: row.standard.samples,
      registryUrl: REGISTRY_URL,
      ...(row.standard.transport ? { transport: row.standard.transport } : {}),
    };
  }
  return {
    status: 'unmeasured',
    note: row.standard.note,
    registryUrl: REGISTRY_URL,
    ...(row.standard.transport ? { transport: row.standard.transport } : {}),
  };
}

async function withBrowserForTransport(mode, fn) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
        ...transportLaunchArgs(mode),
      ],
    });
    return await fn(browser);
  } finally {
    // Bound browser teardown so a wedged Chromium can't hang the process.
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(10_000)]);
  }
}

async function runInstallForTransport(browser, mode, measureInstall, measureEddy) {
  if (measureEddy) {
    // Two passes on the same port: standard (no resolver) then eddy. Cold-start
    // is resolver-independent — report the eddy pass's samples.
    const base = await runPhase(browser, `${mode}/standard`, false, true);
    const eddy = await runPhase(browser, `${mode}/eddy`, true, true);
    const standard = phaseMetric(mode, base, 'standard', { registryUrl: REGISTRY_URL });
    const eddyMetric = phaseMetric(mode, eddy, 'eddy', {
      registryUrl: REGISTRY_URL,
      resolverUrl: RESOLVER_URL,
    });
    const row = { standard, eddy: eddyMetric };
    return { coldSamples: eddy.cold, row, installMetric: installMetricFromRow(mode, row) };
  }
  if (measureInstall) {
    const std = await runPhase(browser, `${mode}/standard`, false, true);
    const standard = phaseMetric(mode, std, 'standard', { registryUrl: REGISTRY_URL });
    const row = { standard };
    return { coldSamples: std.cold, row, installMetric: installMetricFromRow(mode, row) };
  }
  const coldOnly = await runPhase(browser, 'cold', false, false);
  return {
    coldSamples: coldOnly.cold,
    row: null,
    installMetric: { status: 'requires proxy' },
  };
}

async function main() {
  const measureInstall = Boolean(REGISTRY_URL);
  const measureEddy = measureInstall && Boolean(RESOLVER_URL);
  console.log(
    `bench: ${RUNS} run(s), port ${PORT}, transport ${TRANSPORT_ARG}, install ${measureInstall ? `via ${REGISTRY_URL}` : 'SKIPPED (no VITE_RIFTY_REGISTRY_URL → requires proxy)'}${measureEddy ? ` — standard baseline + eddy fast path (${RESOLVER_URL})` : ''}`,
  );
  await assertPerfPortFree(PORT);

  const transportRows = {};
  let coldSamples;
  let installMetric;
  let firstResult;
  for (const mode of TRANSPORT_MODES) {
    const result = await withBrowserForTransport(mode, (browser) =>
      runInstallForTransport(browser, mode, measureInstall, measureEddy),
    );
    firstResult ??= result;
    if (result.row) transportRows[mode] = result.row;
    if (mode === 'auto') {
      coldSamples = result.coldSamples;
      installMetric = result.installMetric;
    }
  }
  if (!coldSamples || !installMetric) {
    coldSamples = firstResult.coldSamples;
    installMetric = firstResult.installMetric;
  }
  if (Object.keys(transportRows).length > 0) installMetric.transportMatrix = transportRows;

  const presetBoot = await withBrowserForTransport('auto', runPresetBootPhase);

  const artifact = buildArtifact({
    generatedAt: new Date().toISOString(),
    runs: RUNS,
    coldStartSamples: coldSamples,
    install: installMetric,
    presetBoot,
  });

  publishPerfArtifact(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nartifact → ${OUT}\n${JSON.stringify(artifact.metrics, null, 2)}`);
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
