import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { withClientServer } from './client-bundle-browser-proof.mjs';

const program = `
const vm = require('node:vm');
globalThis.__vmHostProbe = 41;
const result = {
  realm: vm.runInNewContext('[]') instanceof Array,
  hostGlobal: vm.runInNewContext('typeof __vmHostProbe'),
};
vm.runInNewContext('eval("__vmEvalLeak = 1")');
result.evalLeak = Object.hasOwn(globalThis, '__vmEvalLeak');
console.log(JSON.stringify(result));
`;

export async function provePackedVmSelection(root, report) {
  const oracle = JSON.parse(
    execFileSync(process.execPath, ['-e', program], { encoding: 'utf8', timeout: 10_000 }),
  );
  assert.deepEqual(oracle, { realm: false, hostGlobal: 'undefined', evalLeak: false });
  await withClientServer(root, async (browser, base) => {
    const main = report.rows.find((row) => row.name === 'main').entry;
    const toolchain = report.rows.find((row) => row.name === 'toolchain').entry;
    await proveReadinessJoin(browser, base, toolchain);
    await proveOrdinaryWorkerName(browser, base, report, oracle);
    const failures = [];
    for (const transport of ['http', 'blob']) {
      for (const engine of ['default', 'quickjs', 'rewrite']) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const wasm = [];
          page.on('request', (request) => {
            if (new URL(request.url()).pathname === '/quickjs.wasm') wasm.push(request.url());
          });
          await page.goto(base);
          const result = await page.evaluate(
            async ({ main, toolchain, transport, engine, program }) => {
              const { createSandbox } = await import(main);
              const url = new URL(`${toolchain}?host-query=preserved#host-fragment`, location.href)
                .href;
              const workerUrl =
                transport === 'blob'
                  ? URL.createObjectURL(
                      new Blob(
                        [
                          `globalThis.__RIFTY_QUICKJS_WASM_URL = ${JSON.stringify(new URL('/quickjs.wasm', location.href).href)}; await import(${JSON.stringify(url)});`,
                        ],
                        { type: 'text/javascript' },
                      ),
                    )
                  : url;
              const sandbox = await createSandbox({
                requireCrossOriginIsolation: false,
                skipServiceWorker: true,
                toolchain: { workerUrl },
                ...(engine === 'default' ? {} : { vmEngine: engine }),
              });
              try {
                const outputs = [];
                const metadata = [];
                let current = '';
                sandbox.runtime.on((event) => {
                  if (event.type === 'stdout') current += event.chunk;
                });
                for (let generation = 0; generation < 2; generation++) {
                  if (generation) await sandbox.restart({ preview: { src: '' } });
                  current = '';
                  const result = await sandbox.runtime.eval(program);
                  if (!result.ok) throw new Error(JSON.stringify(result));
                  outputs.push(JSON.parse(current.trim()));
                  current = '';
                  await sandbox.runtime.eval(
                    'console.log(JSON.stringify({workerName:globalThis.name,workerUrl:globalThis.location.href}));void 0',
                  );
                  metadata.push(JSON.parse(current.trim()));
                }
                return {
                  outputs,
                  metadata,
                  workerUrl,
                  capability:
                    sandbox.capabilityReport.features.find((row) => row.feature === 'node:vm') ??
                    null,
                };
              } finally {
                sandbox.dispose();
                if (transport === 'blob') URL.revokeObjectURL(workerUrl);
              }
            },
            { main, toolchain, transport, engine, program },
          );
          const quickjs = engine === 'quickjs';
          assert.equal(
            wasm.length,
            quickjs ? 2 : 0,
            `${transport}/${engine}: WASM requests across boot/restart`,
          );
          const expected = quickjs ? oracle : { realm: true, hostGlobal: 'number', evalLeak: true };
          assert.deepEqual(
            result.outputs,
            [expected, expected],
            `${transport}/${engine}: VM semantics`,
          );
          assert.deepEqual(
            result.metadata,
            Array.from({ length: 2 }, () => ({
              workerName: `rifty-vm-engine=${quickjs ? 'quickjs' : 'rewrite'}`,
              workerUrl: result.workerUrl,
            })),
          );
          assert.equal(result.capability?.status, quickjs ? 'working' : 'degraded');
          if (!quickjs) assert.match(result.capability.warning, /rewrite.*quickjs/iu);
        } catch (error) {
          failures.push(new Error(`${transport}/${engine}: ${error.message}`, { cause: error }));
        } finally {
          await context.close();
        }
      }
    }
    const runtimeHost = report.rows.find((row) => row.name === 'runtimeHost').entry;
    const generic = report.rows.find((row) => row.name === 'generic').entry;
    for (const engine of ['default', 'quickjs', 'rewrite', 'quickjs-fetch-failure']) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const wasm = [];
        page.on('request', (request) => {
          if (new URL(request.url()).pathname === '/quickjs.wasm') wasm.push(request.url());
        });
        if (engine === 'quickjs-fetch-failure')
          await page.route(`${base}/quickjs.wasm`, (route) => route.abort());
        await page.goto(base);
        const observed = await page.evaluate(
          async ({ runtimeHost, generic, engine, program }) => {
            const { spawnRuntime } = await import(runtimeHost);
            const runtime = spawnRuntime({
              workerUrl: generic,
              ...(engine === 'default'
                ? {}
                : { vmEngine: engine === 'quickjs-fetch-failure' ? 'quickjs' : engine }),
            });
            let output = '';
            const stderr = [];
            runtime.on((event) => {
              if (event.type === 'stdout') output += event.chunk;
              if (event.type === 'stderr') stderr.push(event.chunk);
            });
            try {
              await new Promise((resolveReady, reject) => {
                const timeout = setTimeout(
                  () => reject(new Error('runtime readiness timeout')),
                  60000,
                );
                runtime.on((event) => {
                  if (event.type === 'ready') {
                    clearTimeout(timeout);
                    resolveReady();
                  }
                });
              });
              const result = await runtime.eval(program);
              return { result, stderr, output };
            } finally {
              runtime.dispose();
            }
          },
          { runtimeHost, generic, engine, program },
        );
        assert.equal(wasm.length, engine === 'rewrite' ? 0 : 1, `generic/${engine}: WASM requests`);
        if (engine === 'quickjs-fetch-failure') {
          assert.equal(observed.result.ok, false);
          assert.match(observed.stderr.join(''), /QuickJS.*preload failed/u);
        } else {
          assert.equal(observed.result.ok, true);
          assert.deepEqual(
            JSON.parse(observed.output.trim()),
            engine === 'rewrite' ? { realm: true, hostGlobal: 'number', evalLeak: true } : oracle,
          );
        }
      } catch (error) {
        failures.push(new Error(`generic/${engine}: ${error.message}`, { cause: error }));
      } finally {
        await context.close();
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Packed VM selection failures');
  });
}

async function proveReadinessJoin(browser, base, entry) {
  const context = await browser.newContext();
  let release;
  const released = new Promise((resolveRelease) => {
    release = resolveRelease;
  });
  try {
    const page = await context.newPage();
    await page.route(`${base}/quickjs.wasm`, async (route) => {
      await released;
      await route.continue();
    });
    await page.goto(base);
    const requested = page.waitForRequest(`${base}/quickjs.wasm`);
    await page.evaluate((entry) => {
      const worker = new Worker(entry, { type: 'module', name: 'rifty-vm-engine=quickjs' });
      globalThis.vmBarrier = { worker, ready: false, pong: false };
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') globalThis.vmBarrier.ready = true;
        if (data.type === 'pong') globalThis.vmBarrier.pong = true;
      };
    }, entry);
    await requested;
    await page.evaluate(() => globalThis.vmBarrier.worker.postMessage({ type: 'ping' }));
    // Actual same-peer FIFO pong is a causal barrier, not an elapsed-time guess.
    await page.waitForFunction(() => globalThis.vmBarrier.pong);
    assert.equal(
      await page.evaluate(() => globalThis.vmBarrier.ready),
      false,
      'ready escaped while selected WASM was held',
    );
    release();
    await page.waitForFunction(() => globalThis.vmBarrier.ready);
    await page.evaluate(() => globalThis.vmBarrier.worker.terminate());
  } finally {
    release();
    await context.close();
  }
}

async function proveOrdinaryWorkerName(browser, base, report, oracle) {
  for (const kind of ['generic', 'toolchain']) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const wasm = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/quickjs.wasm') wasm.push(request.url());
      });
      await page.goto(base);
      await page.evaluate(
        ({ entry, program }) => {
          const worker = new Worker(entry, { type: 'module', name: 'custom-worker-label' });
          globalThis.vmRaw = { worker, output: '', result: null };
          worker.onmessage = ({ data }) => {
            if (data.type === 'ready')
              worker.postMessage({ type: 'eval', request: { id: 1, code: program } });
            if (data.type === 'stdout') globalThis.vmRaw.output += data.chunk;
            if (data.type === 'result') globalThis.vmRaw.result = data.result;
          };
        },
        { entry: report.rows.find((row) => row.name === kind).entry, program },
      );
      await page.waitForFunction(() => globalThis.vmRaw.result !== null);
      const observation = await page.evaluate(() => {
        globalThis.vmRaw.worker.terminate();
        return { result: globalThis.vmRaw.result, output: globalThis.vmRaw.output };
      });
      assert.equal(observation.result.ok, true);
      assert.deepEqual(
        JSON.parse(observation.output.trim()),
        kind === 'generic' ? oracle : { realm: true, hostGlobal: 'number', evalLeak: true },
      );
      assert.equal(
        wasm.length,
        kind === 'generic' ? 1 : 0,
        `${kind}: ordinary name must retain the tier default`,
      );
    } finally {
      await context.close();
    }
  }
}
