#!/usr/bin/env node
/**
 * Replayable no-COI realm probe: `node tools/probes/no-coi-realm-probe.mjs`
 * regenerates the whole evidence table as raw JSON on stdout — real built shim
 * in no-COI Chromium (page + Worker × direct/aggregate), kernel PUBLIC
 * `createSabRing()`, and the Node oracle (binding intact + deleted, plus the
 * REAL `node:util/types` differential). Durable record:
 * `docs/backlog/runtime-js/reference/no-coi-degradation-probes.md` §2026-08-29.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixturesDir = join(repoRoot, 'tests', 'no-coi', 'fixtures');
const port = Number(process.env.RIFTY_NO_COI_PORT ?? 5309);

const { buildNoCoiFixtures } = await import(
  pathToFileURL(join(repoRoot, 'tests', 'no-coi', 'build-fixtures.mjs')).href
);
const { startNoCoiServer } = await import(
  pathToFileURL(join(repoRoot, 'tests', 'no-coi', 'server.mjs')).href
);

await buildNoCoiFixtures();
// Kernel public createSabRing (row 12) — probe-only bundle, not a lane fixture.
await build({
  entryPoints: [{ in: join(repoRoot, 'packages/kernel/src/ipc/sab-ring.ts'), out: 'sab-ring' }],
  bundle: true,
  format: 'esm',
  outdir: join(fixturesDir, 'dist'),
  outExtension: { '.js': '.mjs' },
  logLevel: 'silent',
});

/** Run probe-lib in a fresh Node child; `dropSab` deletes the global binding
 * first. Passes the REAL `node:util/types` (imported BEFORE install — the
 * patched decode poisons the ESM loader in the binding-less sim). */
function nodeProbe(mode, dropSab) {
  const libUrl = pathToFileURL(join(fixturesDir, 'probe-lib.mjs')).href;
  const script = `
    ${dropSab ? 'delete globalThis.SharedArrayBuffer;' : ''}
    const nativeUtilTypes = await import('node:util/types');
    const { runProbe } = await import(${JSON.stringify(libUrl)});
    const result = await runProbe(${JSON.stringify(mode)}, { requireNoCoi: false, nativeUtilTypes });
    console.log(JSON.stringify(result));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

const server = await startNoCoiServer(port);
const browser = await chromium.launch();
try {
  const transcript = {
    generated: new Date().toISOString(),
    command: 'node tools/probes/no-coi-realm-probe.mjs',
    chromium: browser.version(),
    node: process.version,
    server: `http://localhost:${port}/ (plain node:http, NO COOP/COEP — tests/no-coi/server.mjs)`,
    probeBody: 'tests/no-coi/fixtures/probe-lib.mjs (imports esbuild of the real prod sources)',
    chromiumNoCoi: {},
    nodeOracle: {},
  };

  for (const realm of ['page', 'worker']) {
    for (const mode of ['direct', 'aggregate']) {
      const page = await browser.newPage();
      try {
        await page.goto(`http://localhost:${port}/index.html`);
        transcript.chromiumNoCoi[`${realm}-${mode}`] =
          realm === 'page'
            ? await page.evaluate(async (m) => {
                const lib = await import('/probe-lib.mjs');
                return await lib.runProbe(m);
              }, mode)
            : await page.evaluate(async (m) => {
                const worker = new Worker(`/probe-worker.mjs?mode=${m}`, { type: 'module' });
                const msg = await new Promise((resolve, reject) => {
                  worker.onmessage = (e) => resolve(e.data);
                  worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
                });
                worker.terminate();
                if (!msg.ok) throw new Error(`worker probe failed: ${msg.error}`);
                return msg.result;
              }, mode);
      } finally {
        await page.close();
      }
    }
  }

  // Row 12: kernel PUBLIC createSabRing() in the no-COI page realm.
  {
    const page = await browser.newPage();
    try {
      await page.goto(`http://localhost:${port}/index.html`);
      transcript.chromiumNoCoi.createSabRing = await page.evaluate(async () => {
        const ring = await import('/dist/sab-ring.mjs');
        try {
          ring.createSabRing();
          return { ok: true };
        } catch (err) {
          return { ok: false, errName: err.name, errMsg: err.message };
        }
      });
    } finally {
      await page.close();
    }
  }

  transcript.nodeOracle['binding-intact-direct'] = nodeProbe('direct', false);
  transcript.nodeOracle['binding-deleted-direct'] = nodeProbe('direct', true);

  console.log(JSON.stringify(transcript, null, 2));
} finally {
  await browser.close();
  server.close();
}
