import assert from 'node:assert/strict';
import { withClientServer } from './client-bundle-browser-proof.mjs';

export async function provePackedInstallLoading(root, report) {
  const worker = report.rows.find((row) => row.name === 'toolchain');
  assert(worker.installLoad, 'toolchain has no first-use install entry');
  assert.deepEqual(
    worker.eager.filter((path) => worker.install.includes(path)),
    [],
    'install machinery remains in the eager toolchain graph',
  );
  await withClientServer(root, async (browser, base) => {
    const host = report.rows.find((row) => row.name === 'toolchainHost').entry;
    await provePendingImport(browser, base, host, worker);
    for (const operation of ['install', 'restore'])
      for (const fault of [false, true]) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const requests = [];
          page.on('request', (request) => requests.push(new URL(request.url()).pathname));
          if (fault) await page.route(`${base}${worker.installLoad}`, (route) => route.abort());
          await page.goto(base);
          const before = await page.evaluate(
            async ({ host, worker }) => {
              const { spawnToolchainRuntime } = await import(host);
              const runtime = spawnToolchainRuntime({ workerUrl: worker });
              globalThis.installProof = { runtime, output: '' };
              runtime.on((event) => {
                if (event.type === 'stdout') globalThis.installProof.output += event.chunk;
              });
              await runtime.toolchainReady;
              await runtime.fs.mkdir('/workspace', { recursive: true });
              await runtime.fs.writeFile(
                '/workspace/package.json',
                '{"name":"lazy-install-probe","version":"1.0.0"}',
              );
              await runtime.fs.writeFile('/before.txt', 'before');
              return {
                eval: await runtime.eval('console.log(40+2);void 0'),
                value: await runtime.fs.readFile('/before.txt', 'utf8'),
              };
            },
            { host, worker: worker.entry },
          );
          assert.equal(before.eval.ok, true);
          assert.equal(before.value, 'before');
          assert(
            !requests.some((path) => worker.install.includes(path)),
            'boot/eval/fs fetched install machinery',
          );
          const result = await page.evaluate(
            async ({ operation, registryUrl }) => {
              const { runtime } = globalThis.installProof;
              let error = null;
              try {
                if (operation === 'install')
                  await runtime.toolchain.install({ cwd: '/workspace', registryUrl });
                else
                  await runtime.restoreToolchainState({
                    cwd: '/workspace',
                    bindings: [],
                    vfsBackend: 'memory',
                    files: [{ path: '/restored.txt', data: new TextEncoder().encode('restored') }],
                  });
              } catch (e) {
                error = { name: e.name, message: e.message };
              }
              await runtime.fs.writeFile('/after.txt', 'after');
              const evaluated = await runtime.eval('console.log(6*7);void 0');
              const value = await runtime.fs.readFile('/after.txt', 'utf8');
              const restored =
                operation === 'restore' && !error
                  ? await runtime.fs.readFile('/restored.txt', 'utf8')
                  : null;
              const state = runtime.snapshotToolchainState();
              return {
                error,
                evaluated,
                value,
                restored,
                state: state && { cwd: state.cwd, bindings: state.bindings },
                output: globalThis.installProof.output,
              };
            },
            { operation, registryUrl: `${base}/registry` },
          );
          assert(
            requests.includes(worker.installLoad),
            'first operation never fetched install entry',
          );
          assert.equal(result.evaluated.ok, true);
          assert.equal(result.value, 'after');
          assert.equal(result.output.trim(), '42\n42');
          if (fault) {
            assert.match(
              result.error?.message ?? '',
              /Failed to fetch dynamically imported module/u,
            );
            assert.equal(result.state, null);
          } else {
            assert.equal(result.error, null);
            assert.deepEqual(result.state, { cwd: '/workspace', bindings: [] });
            if (operation === 'restore') assert.equal(result.restored, 'restored');
            await page.evaluate(
              async ({ operation, registryUrl }) => {
                const { runtime } = globalThis.installProof;
                if (operation === 'install')
                  await runtime.toolchain.install({ cwd: '/workspace', registryUrl });
                else await runtime.restoreToolchainState(runtime.snapshotToolchainState());
              },
              { operation, registryUrl: `${base}/registry` },
            );
          }
          assert.equal(
            requests.filter((path) => path === worker.installLoad).length,
            1,
            'first-use module must be reused',
          );
          await page.evaluate(() => globalThis.installProof.runtime.dispose());
        } finally {
          await context.close();
        }
      }
  });
}

async function provePendingImport(browser, base, host, worker) {
  const context = await browser.newContext();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let requested;
  const fetched = new Promise((resolve) => {
    requested = resolve;
  });
  try {
    const page = await context.newPage();
    let count = 0;
    await page.route(`${base}${worker.installLoad}`, async (route) => {
      count++;
      requested();
      await held;
      await route.continue();
    });
    await page.goto(base);
    await page.evaluate(
      async ({ host, worker, registryUrl }) => {
        const { spawnToolchainRuntime } = await import(host);
        const runtime = spawnToolchainRuntime({ workerUrl: worker });
        globalThis.pendingProof = { runtime, registryUrl };
        await runtime.toolchainReady;
        await runtime.fs.mkdir('/workspace', { recursive: true });
        await runtime.fs.writeFile(
          '/workspace/package.json',
          '{"name":"pending-import","version":"1.0.0"}',
        );
        globalThis.pendingProof.first = runtime.toolchain
          .install({ cwd: '/workspace', registryUrl })
          .then(
            () => null,
            (error) => ({ name: error.name, message: error.message }),
          );
      },
      { host, worker: worker.entry, registryUrl: `${base}/registry` },
    );
    let timer;
    try {
      await Promise.race([
        fetched,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('first install did not request deferred code')),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const rejected = await page.evaluate(async () => {
      const { runtime, registryUrl } = globalThis.pendingProof;
      try {
        await runtime.toolchain.install({ cwd: '/workspace', registryUrl });
        return null;
      } catch (error) {
        return error.name;
      }
    });
    assert.equal(rejected, 'SandboxToolchainBusyError');
    release();
    assert.equal(await page.evaluate(() => globalThis.pendingProof.first), null);
    await page.evaluate(async () => {
      const { runtime, registryUrl } = globalThis.pendingProof;
      await runtime.toolchain.install({ cwd: '/workspace', registryUrl });
      runtime.dispose();
    });
    assert.equal(count, 1);
  } finally {
    release();
    await context.close();
  }
}
