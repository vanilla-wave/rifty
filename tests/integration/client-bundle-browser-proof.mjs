import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

export async function withClientServer(root, observe) {
  const require = createRequire(resolve(root, 'package.json'));
  const wasm = require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm');
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
      response.setHeader('Cache-Control', 'no-store');
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Packed client proof</title>');
        return;
      }
      const path = pathname === '/quickjs.wasm' ? wasm : resolve(root, `.${pathname}`);
      if (path !== wasm && !path.startsWith(`${root}${sep}`)) throw new Error('outside fixture');
      const body = await readFile(path);
      response.setHeader(
        'Content-Type',
        path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      );
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    return await observe(browser, base);
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}

export async function observePackedWorkerBoot(root, report) {
  return await withClientServer(root, async (browser, base) => {
    const rows = [];
    for (const artifact of report.rows.filter((row) =>
      ['generic', 'toolchain'].includes(row.name),
    )) {
      for (let sample = 0; sample < 3; sample++) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const requests = [];
          page.on('request', (request) => requests.push(new URL(request.url()).pathname));
          await page.goto(base);
          const observation = await page.evaluate(async ({ entry, name }) => {
            return await new Promise((resolveBoot, reject) => {
              const started = performance.now();
              const worker = new Worker(entry, { type: 'module' });
              const stderr = [];
              const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error(`boot timeout: ${stderr.join('')}`));
              }, 60_000);
              worker.onerror = (event) => {
                clearTimeout(timeout);
                worker.terminate();
                reject(new Error(event.message));
              };
              worker.onmessage = ({ data }) => {
                if (data.type === 'stderr') stderr.push(data.chunk);
                if (data.type !== (name === 'toolchain' ? 'toolchain-ready' : 'ready')) return;
                clearTimeout(timeout);
                worker.terminate();
                resolveBoot({ milliseconds: performance.now() - started, stderr });
              };
            });
          }, artifact);
          rows.push({ name: artifact.name, sample, ...observation, requests });
        } finally {
          await context.close();
        }
      }
    }
    const result = { chromium: browser.version(), rows };
    await writeFile(resolve(root, 'measure', 'boot.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  });
}

export async function provePackedCompilerLoading(root, report) {
  const boot = await observePackedWorkerBoot(root, report);
  await accountPackedBootRequests(root, report, boot);
  for (const row of boot.rows) {
    const artifact = report.rows.find((candidate) => candidate.name === row.name);
    assert(
      !artifact.compiler.some((path) => row.requests.includes(path)),
      `${row.name} fetched compiler at boot`,
    );
    assert(!row.stderr.some((line) => line.includes('preload failed')), row.stderr.join(''));
    for (const path of row.requests.filter((path) => path.endsWith('.js'))) {
      assert(artifact.eager.includes(path), `Unaccounted boot JS: ${path}`);
    }
  }
  await withClientServer(root, async (browser, base) => {
    const artifact = report.rows.find((row) => row.name === 'eval');
    assert(artifact.compiler.length > 0, 'compiler probe must have a real TypeScript chunk');
    for (const operation of ['eval', 'preload']) {
      for (const fault of [false, true]) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const requests = [];
          page.on('request', (request) => requests.push(new URL(request.url()).pathname));
          if (fault) {
            for (const path of artifact.compiler)
              await page.route(`${base}${path}`, (route) => route.abort());
          }
          await page.goto(base);
          await page.evaluate((entry) => {
            globalThis.compilerWorker = new Worker(entry, { type: 'module' });
          }, artifact.entry);
          const evaluate = (source, explicitCommonJs = false, operation = 'eval') =>
            page.evaluate(
              async ({ source, explicitCommonJs, operation }) => {
                const worker = globalThis.compilerWorker;
                return await new Promise((resolveResult, reject) => {
                  const timeout = setTimeout(
                    () => reject(new Error('compiler probe timed out')),
                    60_000,
                  );
                  const receive = ({ data }) => {
                    if (data.type !== 'compiler-result') return;
                    clearTimeout(timeout);
                    worker.removeEventListener('message', receive);
                    resolveResult(data.result);
                  };
                  worker.addEventListener('message', receive);
                  worker.addEventListener(
                    'error',
                    (event) => {
                      clearTimeout(timeout);
                      reject(new Error(event.message));
                    },
                    { once: true },
                  );
                  worker.postMessage({
                    type: 'compiler-probe',
                    source,
                    explicitCommonJs,
                    operation,
                  });
                });
              },
              { source, explicitCommonJs, operation },
            );
          assert.deepEqual(await evaluate('globalThis.__compilerProbe = 42'), {
            ok: true,
            value: 42,
          });
          assert(
            !artifact.compiler.some((path) => requests.includes(path)),
            'JS eval fetched compiler',
          );
          const result = await evaluate('const value: number = 1', false, operation);
          assert.equal(result.ok, operation === 'preload' && !fault);
          assert(
            artifact.compiler.some((path) => requests.includes(path)),
            'non-JS eval never requested compiler',
          );
          if (fault) {
            assert.match(result.message, /TypeScript compiler chunk failed to load/u);
            assert.match(result.cause, /Failed to fetch dynamically imported module/u);
            // Chromium names the requested import() entry when its shared dependency fails.
            assert(result.cause.includes(artifact.compilerLoads[operation]), result.cause);
            if (operation === 'preload') {
              assert.equal((await evaluate('', false, 'check-ready')).code, 'TSCONFIG_NOT_READY');
              for (const mode of ['default-paths', 'explicit-paths']) {
                assert.deepEqual(await evaluate('', false, mode), { ok: true, value: 42 });
              }
            }
          } else if (operation === 'preload') {
            assert.deepEqual(result, { ok: true, value: 42 });
          } else {
            assert.equal(
              result.feature,
              'runtime-js.node-eval-typescript-context',
              JSON.stringify(result),
            );
            const explicit = await evaluate('const value: number = 1', true);
            assert.equal(explicit.name, 'SyntaxError');
            assert.match(explicit.stack, /const value: number = 1\n {6}\^{5}/u);
          }
        } finally {
          await context.close();
        }
      }
    }
  });
  return boot;
}

/** Readiness-joined import() is boot traffic too; Chromium is its authority. */
export async function accountPackedBootRequests(root, report, boot) {
  for (const observation of boot.rows) {
    const artifact = report.rows.find((row) => row.name === observation.name);
    const meta = JSON.parse(
      await readFile(resolve(root, 'measure', artifact.name, 'metafile.json'), 'utf8'),
    );
    for (const path of observation.requests.filter((path) => path.endsWith('.js'))) {
      if (artifact.eager.includes(path)) continue;
      const absolute = resolve(root, `.${path}`);
      const output = Object.entries(meta.outputs).find(
        ([name]) => resolve(root, name) === absolute,
      )?.[1];
      assert(output, `Boot fetched JS outside measured outputs: ${path}`);
      const bytes = await readFile(absolute);
      artifact.min += bytes.length;
      artifact.gzip += gzipSync(bytes).length;
      artifact.eager.push(path);
      for (const [input, info] of Object.entries(output.inputs)) {
        artifact.inputs[input] = (artifact.inputs[input] ?? 0) + info.bytesInOutput;
      }
    }
  }
  await writeFile(resolve(root, 'measure', 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
