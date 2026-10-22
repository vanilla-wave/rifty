#!/usr/bin/env node
// THROWAWAY A/B resource experiment. See no-coi-resource-prototype/README.md.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { memoryProbe } from './no-coi-resource-prototype/memory.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const args = process.argv.slice(2);
const option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const runs = Number(option('--runs', '3'));
const warmupPairs = Number(option('--warmup-pairs', '1'));
const variants = option('--variants', 'baseline,prototype').split(',');
const port = Number(option('--port', '5491'));
const out = resolve(option('--out', '/tmp/rifty-no-coi-resource-prototype'));
const base = `http://127.0.0.1:${port}`;
const browserModule = `/@fs${root}/tools/perf/no-coi-resource-prototype/browser.mjs`;
await mkdir(out, { recursive: true });
try {
  const listener = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  throw new Error(`Port occupied:\n${listener}`);
} catch (error) {
  if (error.status !== 1) throw error;
}
const server = spawn('pnpm', ['dev:no-coi'], {
  cwd: resolve(root, 'apps/playground'),
  env: { ...process.env, RIFTY_NO_COI_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let serverTail = '';
const remember = (chunk) => {
  serverTail = (serverTail + chunk).slice(-20000);
};
server.stdout.on('data', remember);
server.stderr.on('data', remember);
const report = {
  generatedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.version,
  runs: [],
  notes: [
    'Dev server, real npm install excluded from measured workloads.',
    'Timing runs have no RSS sampler. Separate memory run samples renderer RSS every 100ms.',
    'Prototype requires OPFS and rejects OPFS-to-memory recovery.',
  ],
};
const save = () => writeFile(resolve(out, 'results.json'), JSON.stringify(report, null, 2));
const progress = (phase, extra = {}) => console.log(JSON.stringify({ phase, ...extra }));
try {
  const deadline = Date.now() + 120000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`Dev server exited: ${serverTail}`);
    try {
      if ((await fetch(`${base}/no-coi-harness.html`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`Dev server timeout: ${serverTail}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (let ordinal = 0; ordinal < runs + warmupPairs; ordinal++) {
    const order = ordinal % 2 === 0 ? variants : [...variants].reverse();
    for (const variant of order) {
      progress('start', { ordinal, variant });
      const launched = await chromium.launchServer({ headless: true });
      const browser = await chromium.connect(launched.wsEndpoint());
      const row = {
        ordinal,
        variant,
        warmup: ordinal < warmupPairs,
        chromium: browser.version(),
        memory: [],
        builds: [],
        reads: [],
      };
      report.runs.push(row);
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.on('pageerror', (error) => progress('pageerror', { error: error.message }));
        await page.route('**/resource-prototype.html', (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>THROWAWAY resource prototype</title>',
          }),
        );
        await page.goto(`${base}/resource-prototype.html`);
        const probe = await memoryProbe(browser, context, page, launched.process().pid);
        const invoke = (method, input) =>
          page.evaluate(
            async ({ module, method, input }) => (await import(module))[method](...input),
            { module: browserModule, method, input },
          );
        row.memory.push(await probe.retained('blank'));
        const setupAt = Date.now();
        row.setup = await invoke('prepare', [root, variant]);
        row.setupMs = Date.now() - setupAt;
        assert.equal(row.setup.vfs.backend, 'opfs');
        progress('installed', { ordinal, variant, setupMs: row.setupMs });
        row.memory.push(await probe.retained('installed'));
        for (let i = 0; i < 3; i++) {
          const build = await invoke('command', ['node node_modules/vite/bin/vite.js build']);
          assert.match(build.stdout + build.stderr, /modules transformed/);
          row.builds.push({ ...build, temperature: i === 0 ? 'first' : 'repeat' });
          progress('build', { ordinal, variant, iteration: i, elapsedMs: build.elapsedMs });
        }
        row.inventory = await invoke('inventory', [root]);
        row.memory.push(await probe.retained('after-build'));
        for (let i = 0; i < 3; i++) {
          const read = await invoke('command', ['node read-parent.cjs']);
          const payload = JSON.parse(read.stdout.trim());
          assert.equal(payload.hash, row.inventory.wasm.sha256);
          assert.equal(payload.bytes, row.inventory.wasm.bytes);
          row.reads.push({ elapsedMs: read.elapsedMs, ...payload });
          progress('read', {
            ordinal,
            variant,
            iteration: i,
            elapsedMs: read.elapsedMs,
            innerMs: payload.samples,
          });
        }
        row.echoMs = [];
        for (let i = 0; i < 7; i++)
          row.echoMs.push((await invoke('command', ['echo ok'])).elapsedMs);
        row.memory.push(await probe.retained('before-memory-build'));
        row.memoryBuild = await probe.sampled(() =>
          invoke('command', ['node node_modules/vite/bin/vite.js build']),
        );
        row.memory.push(await probe.retained('after-memory-build'));
        row.memoryRead = await probe.sampled(() => invoke('command', ['node read-parent.cjs']));
        row.memory.push(await probe.retained('after-memory-read'));
        const dist = await invoke('exportDist', []);
        const proof = await context.newPage();
        const mime = (path) =>
          path.endsWith('.js')
            ? 'text/javascript'
            : path.endsWith('.css')
              ? 'text/css'
              : path.endsWith('.html')
                ? 'text/html'
                : 'application/octet-stream';
        await proof.route('**/*', (route) => {
          const path = new URL(route.request().url()).pathname.slice(1) || 'index.html';
          const file = dist.find((f) => f.path === path);
          return file
            ? route.fulfill({ body: Buffer.from(file.base64, 'base64'), contentType: mime(path) })
            : route.fulfill({ status: 404, body: path });
        });
        await proof.goto(`${base}/index.html`);
        await proof.getByText('iteration bench-seed', { exact: true }).waitFor({ timeout: 30000 });
        row.renderedText = await proof.locator('#root').innerText();
        await proof.screenshot({ path: resolve(out, `${ordinal}-${variant}-app.png`) });
        await proof.close();
        row.restart = await page.evaluate(async () => {
          const sandbox = globalThis.resourceSandbox;
          const before = await sandbox.fs.readFile('/project/src/Panel.jsx', 'utf8');
          await sandbox.restart({ preview: { src: '' } });
          const after = await sandbox.fs.readFile('/project/src/Panel.jsx', 'utf8');
          if (before !== after) throw new Error('restart lost project content');
          const result = await globalThis.resourceProject.run('echo restored').completion;
          if (result.stdout !== 'restored\n' || result.exitCode !== 0)
            throw new Error('restart command failed');
          return { contentPreserved: true, commandPassed: true };
        });
        row.memory.push(await probe.retained('after-restart'));
        await page.evaluate(() => globalThis.resourceSandbox.dispose());
        row.memory.push(await probe.retained('disposed-retained-handle'));
        await page.evaluate(() => {
          globalThis.resourceSandbox = null;
          globalThis.resourceProject = null;
        });
        row.memory.push(await probe.retained('disposed-released-handle'));
        row.status = 'passed';
        progress('finished', {
          ordinal,
          variant,
          fileBytes: row.inventory.bytes,
          files: row.inventory.files,
        });
        await context.close();
      } catch (error) {
        row.status = 'failed';
        row.error = String(error);
        await save();
        throw error;
      } finally {
        await browser.close();
        await launched.close();
        await save();
      }
    }
  }
  const first = report.runs[0].inventory;
  for (const run of report.runs) {
    assert.deepEqual(run.inventory.dist, first.dist, 'build outputs differ across variants');
    assert.deepEqual(run.inventory.versions, first.versions, 'installed versions differ');
    assert.deepEqual(run.inventory.wasm, first.wasm, 'upstream WASM differs');
    assert.deepEqual(run.inventory.lock, first.lock, 'resolved dependency graph differs');
  }
  report.identicalOutputs = true;
  await save();
  progress('complete', { artifact: resolve(out, 'results.json') });
} finally {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
}
