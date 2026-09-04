import { type Page, type Request, expect, test } from '@playwright/test';
import type { RuntimeEvent, ToolchainSandbox } from '../../packages/rifty/src/index.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const sdkModuleUrl = `/@fs${workspacePath}/packages/rifty/src/index.ts`;
const toolchainWorkerUrl = `/@fs${workspacePath}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;
const memoryToolchainWorkerUrl = `/@fs${workspacePath}/tests/no-coi/fixtures/no-coi-toolchain-memory-worker.ts`;
const projectRoot = '/dev-hmr';
const port = 5174;
const startRequest = {
  cwd: projectRoot,
  binPath: `${projectRoot}/node_modules/.bin/vite`,
  args: ['--host', '127.0.0.1', '--port', String(port), '--strictPort', '--force'],
  port,
} as const;

type DevSandbox = ToolchainSandbox;
type RuntimeExitEvent = Extract<RuntimeEvent, { readonly type: 'exit' }>;

const realProjectFiles: Readonly<Record<string, string>> = {
  [`${projectRoot}/package.json`]: JSON.stringify({
    name: 'no-coi-dev-hmr',
    private: true,
    type: 'module',
    devDependencies: { vite: '7.3.6' },
  }),
  [`${projectRoot}/index.html`]:
    '<!doctype html><html><body><main id="app"></main><script type="module" src="/src/main.js"></script></body></html>',
  [`${projectRoot}/src/main.js`]: `import { marker } from './hmr-value.js';
import './wedge.js';
const node = document.createElement('output');
node.id = 'hmr-marker';
node.dataset.bootId = crypto.randomUUID();
document.querySelector('#app').append(node);
const paint = (value) => { node.textContent = value; };
paint(marker);
if (import.meta.hot) import.meta.hot.accept('./hmr-value.js', (next) => paint(next.marker));
`,
  [`${projectRoot}/src/hmr-value.js`]: "export const marker = 'hmr-a';\n",
  [`${projectRoot}/src/wedge.js`]: "export const wedge = 'safe';\n",
  [`${projectRoot}/vite.config.js`]: `export default {
  plugins: [{
    name: 'no-coi-real-wedge',
    transform(code, id) {
      if (id.endsWith('/src/wedge.js') && code.includes('WEDGE_NOW')) while (true) {}
      return null;
    },
  }],
};
`,
};

async function bootSandbox(page: Page, workerUrl = toolchainWorkerUrl): Promise<Page> {
  await page.goto('/no-coi-harness.html');
  await expect(page.locator('#no-coi-harness')).toHaveAttribute('data-status', 'ready');
  await page.evaluate(
    async ({ sdkUrl, toolchainUrl }) => {
      const NativeWorker = globalThis.Worker;
      Reflect.set(globalThis, '__riftyWorkerCount', 0);
      Reflect.set(
        globalThis,
        'Worker',
        new Proxy(NativeWorker, {
          construct(target, args) {
            const count = Reflect.get(globalThis, '__riftyWorkerCount') as number;
            Reflect.set(globalThis, '__riftyWorkerCount', count + 1);
            return Reflect.construct(target, args);
          },
        }),
      );
      const sdk = await import(/* @vite-ignore */ sdkUrl);
      const sandbox = (await sdk.createSandbox({
        requireCrossOriginIsolation: false,
        serviceWorkerUrl: '/sw.js',
        toolchain: { workerUrl: toolchainUrl },
      })) as DevSandbox;
      Reflect.set(globalThis, '__riftyDevSandbox', sandbox);
    },
    { sdkUrl: sdkModuleUrl, toolchainUrl: workerUrl },
  );
  return page;
}

test('capability report advertises the resident dev-HMR surface — designed RED', async ({
  page,
}) => {
  await bootSandbox(page);
  try {
    const feature = await page.evaluate(() => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      return sandbox.capabilityReport.features.find(
        (candidate) => candidate.feature === 'toolchain.dev-hmr',
      );
    });
    expect(feature).toEqual({ feature: 'toolchain.dev-hmr', status: 'working' });
  } finally {
    await disposeSandbox(page);
  }
});

test('overlapping restart rejects without a queue or second surviving generation — designed RED', async ({
  page,
}) => {
  await bootSandbox(page);
  try {
    const outcome = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      if (typeof sandbox.restart !== 'function') {
        throw new Error('ToolchainSandbox.restart is missing');
      }
      const preview = { src: '' };
      const first = sandbox.restart({ preview });
      const second = sandbox.restart({ preview });
      const settled = await Promise.allSettled([first, second]);
      return {
        settled: settled.map((entry) =>
          entry.status === 'fulfilled'
            ? { status: entry.status, value: entry.value }
            : {
                status: entry.status,
                name: entry.reason instanceof Error ? entry.reason.name : String(entry.reason),
              },
        ),
        workerCount: Reflect.get(globalThis, '__riftyWorkerCount'),
        previewSrc: preview.src,
      };
    });
    expect(outcome).toEqual({
      settled: [
        { status: 'fulfilled', value: { unflushedWrites: false, resident: null } },
        { status: 'rejected', name: 'SandboxRestartBusyError' },
      ],
      workerCount: 2,
      previewSrc: '',
    });
  } finally {
    await disposeSandbox(page);
  }
});

test('public operations reject while restart owns the replacement generation', async ({ page }) => {
  await bootSandbox(page);
  try {
    await writeFiles(page, { '/restart-race.txt': 'before' });
    const outcome = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const restart = sandbox.restart({
        preview: { src: '' },
        beforeStart: async (repairFs) => {
          enter();
          await gate;
          await repairFs.writeFile('/restart-repair.txt', 'repaired');
        },
      });
      await entered;
      const inspect = async (operation: Promise<unknown>) => {
        try {
          await operation;
          return { status: 'fulfilled' };
        } catch (error) {
          return { status: 'rejected', name: (error as Error).name };
        }
      };
      const operations = await Promise.all([
        inspect(sandbox.runtime.eval('42')),
        inspect(sandbox.fs.readFile('/restart-race.txt')),
        inspect(sandbox.fs.writeFile('/restart-lost.txt', 'lost')),
        inspect(sandbox.toolchain.install({ cwd: 'relative', registryUrl: '/registry' })),
        inspect(sandbox.toolchain.runBin({ cwd: 'relative', binPath: '/bad', args: [] })),
        inspect(
          sandbox.toolchain.startBin({ cwd: 'relative', binPath: '/bad', args: [], port: 5179 }),
        ),
      ]);
      const synchronous = [
        () => sandbox.runtime.writeFile('/restart-sync.txt', 'lost'),
        () => sandbox.runtime.writeStdin('lost'),
      ].map((operation) => {
        try {
          operation();
          return { status: 'fulfilled' };
        } catch (error) {
          return { status: 'rejected', name: (error as Error).name };
        }
      });
      const readyDuringRestart = sandbox.runtime.isReady();
      release();
      const report = await restart;
      const repair = await sandbox.fs.readFile('/restart-repair.txt', 'utf8');
      return { operations, synchronous, readyDuringRestart, report, repair };
    });
    expect(outcome).toEqual({
      operations: Array.from({ length: 6 }, () => ({
        status: 'rejected',
        name: 'SandboxRestartBusyError',
      })),
      synchronous: Array.from({ length: 2 }, () => ({
        status: 'rejected',
        name: 'SandboxRestartBusyError',
      })),
      readyDuringRestart: false,
      report: { unflushedWrites: false, resident: null },
      repair: 'repaired',
    });
  } finally {
    await disposeSandbox(page);
  }
});

test('restart claims before caller getters can reenter generation replacement', async ({
  page,
}) => {
  await bootSandbox(page);
  try {
    const outcome = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const preview = { src: '' };
      let inner: Promise<unknown> | undefined;
      const options = Object.defineProperty({}, 'preview', {
        enumerable: true,
        get() {
          inner ??= sandbox.restart({ preview });
          inner.catch(() => {});
          return preview;
        },
      });
      const outer = await sandbox.restart(options as { readonly preview: { src: string } });
      const innerOutcome = await inner?.then(
        () => ({ status: 'fulfilled' }),
        (error: Error) => ({ status: 'rejected', name: error.name }),
      );
      return {
        outer,
        inner: innerOutcome,
        workerCount: Reflect.get(globalThis, '__riftyWorkerCount'),
      };
    });
    expect(outcome).toEqual({
      outer: { unflushedWrites: false, resident: null },
      inner: { status: 'rejected', name: 'SandboxRestartBusyError' },
      workerCount: 2,
    });
  } finally {
    await disposeSandbox(page);
  }
});

test('post-dispose Promise APIs reject asynchronously instead of throwing', async ({ page }) => {
  await bootSandbox(page);
  const outcomes = await page.evaluate(async () => {
    const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
    sandbox.dispose();
    const observe = async (call: () => Promise<unknown>) => {
      let promise: Promise<unknown>;
      try {
        promise = call();
      } catch (error) {
        return { sync: true, name: (error as Error).name };
      }
      try {
        await promise;
        return { sync: false, status: 'fulfilled' };
      } catch (error) {
        return { sync: false, status: 'rejected', message: (error as Error).message };
      }
    };
    return Promise.all([
      observe(() => sandbox.runtime.eval('1')),
      observe(() => sandbox.runtime.reset()),
      observe(() => sandbox.fs.readFile('/x')),
      observe(() => sandbox.fs.writeFile('/x', 'x')),
      observe(() => sandbox.toolchain.install({ cwd: '/x', registryUrl: '/registry' })),
      observe(() =>
        sandbox.toolchain.runBin({
          cwd: '/x',
          binPath: '/x/node_modules/.bin/x',
          args: [],
        }),
      ),
      observe(() =>
        sandbox.toolchain.startBin({
          cwd: '/x',
          binPath: '/x/node_modules/.bin/x',
          args: [],
          port: 5174,
        }),
      ),
      observe(() => sandbox.restart({ preview: { src: '' } })),
    ]);
  });
  expect(outcomes).toHaveLength(8);
  for (const outcome of outcomes) {
    expect(outcome).toEqual({
      sync: false,
      status: 'rejected',
      message: 'Sandbox is disposed',
    });
  }
});

test('resident start rejects pre-bound and wrong-port ownership without false readiness', async ({
  page,
}) => {
  await bootSandbox(page);
  try {
    await writeFiles(page, {
      '/port-proof/node_modules/.bin/plain-dev':
        "#!/usr/bin/env node\nimport('../plain-dev/server.cjs');\n",
      '/port-proof/node_modules/plain-dev/package.json': JSON.stringify({
        name: 'plain-dev',
        type: 'commonjs',
      }),
      '/port-proof/node_modules/plain-dev/server.cjs': `require('node:http').createServer((_req, res) => res.end('selected')).listen(5191, '127.0.0.1');`,
    });
    const prebound = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const events: RuntimeExitEvent[] = [];
      sandbox.runtime.on((event) => {
        if (event.type === 'exit') events.push(event);
      });
      await sandbox.runtime.eval(`await new Promise((resolve, reject) => {
        require('node:http').createServer((_req, res) => res.end('other')).once('error', reject).listen(5191, '127.0.0.1', resolve);
      })`);
      let failure: unknown;
      try {
        await sandbox.toolchain.startBin({
          cwd: '/port-proof',
          binPath: '/port-proof/node_modules/.bin/plain-dev',
          args: [],
          port: 5191,
        });
      } catch (error) {
        const inspected = error as Error & { code?: string };
        failure = { name: inspected.name, code: inspected.code, message: inspected.message };
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { failure, events };
    });
    expect(prebound).toMatchObject({
      failure: { code: 'EADDRINUSE', message: expect.stringContaining('already in use') },
      events: [{ type: 'exit', reason: 'error' }],
    });
  } finally {
    await disposeSandbox(page);
  }

  await bootSandbox(page);
  try {
    await writeFiles(page, {
      '/port-proof/node_modules/.bin/plain-dev':
        "#!/usr/bin/env node\nimport('../plain-dev/server.cjs');\n",
      '/port-proof/node_modules/plain-dev/package.json': JSON.stringify({
        name: 'plain-dev',
        type: 'commonjs',
      }),
      '/port-proof/node_modules/plain-dev/server.cjs': `require('node:http').createServer((_req, res) => res.end('wrong')).listen(5192, '127.0.0.1');`,
    });
    const wrong = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const events: RuntimeExitEvent[] = [];
      sandbox.runtime.on((event) => {
        if (event.type === 'exit') events.push(event);
      });
      let failure: unknown;
      try {
        await sandbox.toolchain.startBin({
          cwd: '/port-proof',
          binPath: '/port-proof/node_modules/.bin/plain-dev',
          args: [],
          port: 5191,
        });
      } catch (error) {
        failure = { name: (error as Error).name, message: (error as Error).message };
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { failure, events };
    });
    expect(wrong).toMatchObject({
      failure: { message: expect.stringContaining('did not listen on port 5191') },
      events: [{ type: 'exit', reason: 'error' }],
    });
  } finally {
    await disposeSandbox(page);
  }
});

test('resident readiness ignores selected auxiliary ports and refuses a delayed rival', async ({
  page,
}) => {
  await bootSandbox(page);
  try {
    await writeFiles(page, {
      '/port-proof/node_modules/.bin/plain-dev':
        "#!/usr/bin/env node\nimport('../plain-dev/server.cjs');\n",
      '/port-proof/node_modules/plain-dev/package.json': JSON.stringify({
        name: 'plain-dev',
        type: 'commonjs',
      }),
      '/port-proof/node_modules/plain-dev/server.cjs': `const http = require('node:http');
http.createServer((_req, res) => res.end('aux')).listen(5194, '127.0.0.1', () => {
  setTimeout(() => http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<output id="hmr-marker" data-boot-id="aux-target">aux-target</output>'); }).listen(5195, '127.0.0.1'), 100);
});`,
    });
    const resident = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const starting = sandbox.toolchain.startBin({
        cwd: '/port-proof',
        binPath: '/port-proof/node_modules/.bin/plain-dev',
        args: [],
        port: 5195,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const inspect = async (operation: Promise<unknown>) => {
        try {
          await operation;
          return { status: 'fulfilled' };
        } catch (error) {
          return { status: 'rejected', name: (error as Error).name };
        }
      };
      const [evalResult, fsDuringStart, started] = await Promise.all([
        sandbox.runtime.eval('42'),
        inspect(sandbox.fs.readFile('/port-proof/node_modules/plain-dev/package.json')),
        starting,
      ]);
      const evalDuringStart = evalResult.ok
        ? { ok: true }
        : { ok: false, name: evalResult.error.name };
      const iframe = document.createElement('iframe');
      iframe.id = 'dev-preview';
      document.body.append(iframe);
      iframe.src = started.previewUrl;
      return { started, evalDuringStart, fsDuringStart };
    });
    expect(resident).toEqual({
      started: { port: 5195, previewUrl: '/preview/5195/' },
      evalDuringStart: { ok: false, name: 'SandboxToolchainBusyError' },
      fsDuringStart: { status: 'rejected', name: 'SandboxToolchainBusyError' },
    });
    await waitForMarker(page, 'aux-target');
  } finally {
    await disposeSandbox(page);
  }

  await bootSandbox(page);
  try {
    await writeFiles(page, {
      '/port-proof/node_modules/.bin/plain-dev':
        "#!/usr/bin/env node\nimport('../plain-dev/server.cjs');\n",
      '/port-proof/node_modules/plain-dev/package.json': JSON.stringify({
        name: 'plain-dev',
        type: 'commonjs',
      }),
      '/port-proof/node_modules/plain-dev/server.cjs': `const http = require('node:http');
const selected = http.createServer((_req, res) => res.end('selected'));
setTimeout(() => selected.listen(5196, '127.0.0.1'), 100);`,
    });
    const rival = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const events: RuntimeExitEvent[] = [];
      sandbox.runtime.on((event) => {
        if (event.type === 'exit') events.push(event);
      });
      await sandbox.runtime.eval(`setTimeout(() => {
        require('node:http').createServer((_req, res) => res.end('rival')).listen(5196, '127.0.0.1');
      }, 20).unref(); 'scheduled'`);
      let failure: unknown;
      try {
        await sandbox.toolchain.startBin({
          cwd: '/port-proof',
          binPath: '/port-proof/node_modules/.bin/plain-dev',
          args: [],
          port: 5196,
        });
      } catch (error) {
        failure = { name: (error as Error).name, message: (error as Error).message };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { failure, events, workerCount: Reflect.get(globalThis, '__riftyWorkerCount') };
    });
    expect(rival).toMatchObject({
      failure: {
        name: 'SandboxResidentPortOwnershipError',
        message: expect.stringContaining('selected installed bin'),
      },
      events: [{ type: 'exit', reason: 'error' }],
      workerCount: 1,
    });
  } finally {
    await disposeSandbox(page);
  }
});

test('resident readiness rejects native deferred target-port rivals', async ({ page }) => {
  const sources = [
    `const signal = AbortSignal.timeout(20);
signal.addEventListener('abort', () => rival.listen(PORT, '127.0.0.1'), { once: true });`,
    `const channel = new MessageChannel();
channel.port1.onmessage = () => rival.listen(PORT, '127.0.0.1');
setTimeout(() => channel.port2.postMessage(null), 20).unref();`,
    `const name = 'resident-rival-' + crypto.randomUUID();
const receiver = new BroadcastChannel(name);
const sender = new BroadcastChannel(name);
receiver.onmessage = () => rival.listen(PORT, '127.0.0.1');
setTimeout(() => sender.postMessage(null), 20).unref();`,
    `new Promise((resolve) => setTimeout(resolve, 20).unref())
  .then(() => rival.listen(PORT, '127.0.0.1'));`,
  ] as const;

  for (const [index, source] of sources.entries()) {
    const targetPort = 5200 + index;
    await bootSandbox(page);
    try {
      await writeFiles(page, {
        '/port-proof/node_modules/.bin/plain-dev':
          "#!/usr/bin/env node\nimport('../plain-dev/server.cjs');\n",
        '/port-proof/node_modules/plain-dev/package.json': JSON.stringify({
          name: 'plain-dev',
          type: 'commonjs',
        }),
        '/port-proof/node_modules/plain-dev/server.cjs': `const http = require('node:http');
const selected = http.createServer((_req, res) => res.end('selected'));
setTimeout(() => selected.listen(${targetPort}, '127.0.0.1'), 100);`,
      });
      const outcome = await page.evaluate(
        async ({ port, schedule }) => {
          const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
          const events: RuntimeExitEvent[] = [];
          sandbox.runtime.on((event) => {
            if (event.type === 'exit') events.push(event);
          });
          const scheduled = await sandbox.runtime.eval(`const http = require('node:http');
const rival = http.createServer((_req, res) => res.end('rival'));
${schedule.replaceAll('PORT', String(port))}
'scheduled';`);
          if (!scheduled.ok) throw new Error(scheduled.error.message);
          let failure: unknown;
          try {
            await sandbox.toolchain.startBin({
              cwd: '/port-proof',
              binPath: '/port-proof/node_modules/.bin/plain-dev',
              args: [],
              port,
            });
          } catch (error) {
            failure = { name: (error as Error).name, message: (error as Error).message };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { failure, events };
        },
        { port: targetPort, schedule: source },
      );
      expect(outcome).toMatchObject({
        failure: {
          name: 'SandboxResidentPortOwnershipError',
          message: expect.stringContaining('selected installed bin'),
        },
        events: [{ type: 'exit', reason: 'error' }],
      });
    } finally {
      await disposeSandbox(page);
    }
  }
});

async function writeFiles(page: Page, files: Readonly<Record<string, string>>): Promise<void> {
  await page.evaluate(async (entries) => {
    const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
    for (const [path, source] of Object.entries(entries)) await sandbox.fs.writeFile(path, source);
  }, files);
}

async function disposeSandbox(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox | undefined;
      sandbox?.dispose();
      Reflect.deleteProperty(globalThis, '__riftyDevSandbox');
    })
    .catch(() => {});
}

async function waitForMarker(
  page: Page,
  marker: string,
): Promise<{ readonly marker: string | null; readonly bootId: string | null }> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement | null;
          const node = iframe?.contentDocument?.querySelector('#hmr-marker') as HTMLElement | null;
          return node?.textContent ?? null;
        }),
      { timeout: 180_000 },
    )
    .toBe(marker);
  return page.evaluate(() => {
    const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement | null;
    const node = iframe?.contentDocument?.querySelector('#hmr-marker') as HTMLElement | null;
    return { marker: node?.textContent ?? null, bootId: node?.dataset.bootId ?? null };
  });
}

test('generic resident start mounts its SW preview without package identity policy — designed RED', async ({
  page,
}) => {
  await bootSandbox(page);
  try {
    await writeFiles(page, {
      [`${projectRoot}/node_modules/.bin/plain-dev`]:
        "#!/usr/bin/env node\nimport('../plain-dev/server.cjs');\n",
      [`${projectRoot}/node_modules/plain-dev/package.json`]: JSON.stringify({
        name: 'plain-dev',
        version: '1.0.0',
        type: 'commonjs',
      }),
      [`${projectRoot}/node_modules/plain-dev/server.cjs`]: `const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<output id="hmr-marker" data-boot-id="decoy">decoy-server</output>'); }).listen(port, '127.0.0.1');
`,
    });
    const plainRequest = {
      ...startRequest,
      binPath: `${projectRoot}/node_modules/.bin/plain-dev`,
    };
    const result = await page.evaluate(async (request) => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      if (typeof sandbox.toolchain.startBin !== 'function') {
        throw new Error('SandboxToolchain.startBin is missing');
      }
      const resident = await sandbox.toolchain.startBin(request);
      const iframe = document.createElement('iframe');
      iframe.id = 'dev-preview';
      document.body.append(iframe);
      if (resident) iframe.src = resident.previewUrl;
      return resident;
    }, plainRequest);
    expect(result).toEqual({ port, previewUrl: `/preview/${port}/` });
    await waitForMarker(page, 'decoy-server');

    const rejected = await page.evaluate(async (request) => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const inspect = async (operation: Promise<unknown>) => {
        try {
          await operation;
          return { status: 'fulfilled' };
        } catch (error) {
          const value = error as Error & { feature?: string };
          return { status: 'rejected', name: value.name, feature: value.feature };
        }
      };
      return {
        install: await inspect(
          sandbox.toolchain.install({ cwd: request.cwd, registryUrl: '/npm-registry' }),
        ),
        run: await inspect(
          sandbox.toolchain.runBin({
            cwd: request.cwd,
            binPath: request.binPath,
            args: [],
          }),
        ),
        secondStart: await inspect(sandbox.toolchain.startBin(request)),
      };
    }, plainRequest);
    expect(rejected).toEqual({
      install: {
        status: 'rejected',
        name: 'NotImplementedError',
        feature: 'sandbox.toolchain.resident-concurrency',
      },
      run: {
        status: 'rejected',
        name: 'NotImplementedError',
        feature: 'sandbox.toolchain.resident-concurrency',
      },
      secondStart: {
        status: 'rejected',
        name: 'SandboxResidentToolBusyError',
        feature: undefined,
      },
    });
    await waitForMarker(page, 'decoy-server');
  } finally {
    await disposeSandbox(page);
  }
});

test('memory-backend restart restores the installed tree before resident relaunch', async ({
  page,
}) => {
  await bootSandbox(page, memoryToolchainWorkerUrl);
  const restartRegistryRequests: string[] = [];
  const trackRestartRequest = (request: Request): void => {
    if (request.url().includes('/npm-registry')) restartRegistryRequests.push(request.url());
  };
  try {
    expect(
      await page.evaluate(() => {
        const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
        return sandbox.vfs.backend;
      }),
    ).toBe('memory');
    await writeFiles(page, realProjectFiles);
    await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      await sandbox.toolchain.install({ cwd: '/dev-hmr', registryUrl: '/npm-registry' });
      const resident = await sandbox.toolchain.startBin({
        cwd: '/dev-hmr',
        binPath: '/dev-hmr/node_modules/.bin/vite',
        args: ['--host', '127.0.0.1', '--port', '5174', '--strictPort', '--force'],
        port: 5174,
      });
      const iframe = document.createElement('iframe');
      iframe.id = 'dev-preview';
      document.body.append(iframe);
      iframe.src = resident.previewUrl;
    });
    const first = await waitForMarker(page, 'hmr-a');
    await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      await sandbox.fs.writeFile(
        '/dev-hmr/src/hmr-value.js',
        "export const marker = 'hmr-memory-before-restart';\n",
      );
      await sandbox.fs.writeFile('/dev-hmr/public-bytes.bin', new Uint8Array([2]));
    });
    const beforeRestart = await waitForMarker(page, 'hmr-memory-before-restart');
    expect(beforeRestart.bootId).toBe(first.bootId);
    page.on('request', trackRestartRequest);
    const report = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement;
      const restarted = await sandbox.restart({ preview: iframe });
      return {
        restarted,
        backend: sandbox.vfs.backend,
        workerCount: Reflect.get(globalThis, '__riftyWorkerCount'),
      };
    });
    expect(report).toEqual({
      restarted: {
        unflushedWrites: false,
        resident: { port: 5174, previewUrl: '/preview/5174/' },
      },
      backend: 'memory',
      workerCount: 2,
    });
    expect(restartRegistryRequests).toEqual([]);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement | null;
            const node = iframe?.contentDocument?.querySelector(
              '#hmr-marker',
            ) as HTMLElement | null;
            return node?.dataset.bootId ?? null;
          }),
        { timeout: 180_000 },
      )
      .not.toBe(first.bootId);
    const recovered = await waitForMarker(page, 'hmr-memory-before-restart');
    expect(recovered.bootId).not.toBe(first.bootId);
    expect(
      await page.evaluate(async () => {
        const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
        return [...(await sandbox.fs.readFile('/dev-hmr/public-bytes.bin'))];
      }),
    ).toEqual([2]);
    await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      await sandbox.fs.writeFile(
        '/dev-hmr/src/hmr-value.js',
        "export const marker = 'hmr-memory';\n",
      );
    });
    const updated = await waitForMarker(page, 'hmr-memory');
    expect(updated.bootId).toBe(recovered.bootId);
    const secondRestart = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement;
      return {
        report: await sandbox.restart({ preview: iframe }),
        workerCount: Reflect.get(globalThis, '__riftyWorkerCount'),
      };
    });
    expect(secondRestart).toEqual({
      report: {
        unflushedWrites: false,
        resident: { port: 5174, previewUrl: '/preview/5174/' },
      },
      workerCount: 3,
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement | null;
            const node = iframe?.contentDocument?.querySelector(
              '#hmr-marker',
            ) as HTMLElement | null;
            return node?.dataset.bootId ?? null;
          }),
        { timeout: 180_000 },
      )
      .not.toBe(recovered.bootId);
    await waitForMarker(page, 'hmr-memory');
  } finally {
    page.off('request', trackRestartRequest);
    await disposeSandbox(page);
  }
});

test('real Vite HMR survives explicit wedge restart and reports the dirty boundary — designed RED', async ({
  page,
}) => {
  await bootSandbox(page);
  const restartRegistryRequests: string[] = [];
  const trackRestartRequest = (request: Request): void => {
    if (request.url().includes('/npm-registry')) restartRegistryRequests.push(request.url());
  };
  try {
    await writeFiles(page, realProjectFiles);
    await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      await sandbox.toolchain.install({ cwd: '/dev-hmr', registryUrl: '/npm-registry' });
      const build = await sandbox.toolchain.runBin({
        cwd: '/dev-hmr',
        binPath: '/dev-hmr/node_modules/.bin/vite',
        args: ['build'],
      });
      if (build.exitCode !== 0) throw new Error(`vite build exited ${build.exitCode}`);
      const builtHtml = await sandbox.fs.readFile('/dev-hmr/dist/index.html', 'utf8');
      if (!builtHtml.includes('<main id="app"></main>')) {
        throw new Error('same-sandbox vite build did not produce dist/index.html');
      }
      if (typeof sandbox.toolchain.startBin !== 'function') {
        throw new Error('SandboxToolchain.startBin is missing');
      }
      const resident = await sandbox.toolchain.startBin({
        cwd: '/dev-hmr',
        binPath: '/dev-hmr/node_modules/.bin/vite',
        args: ['--host', '127.0.0.1', '--port', '5174', '--strictPort', '--force'],
        port: 5174,
      });
      const iframe = document.createElement('iframe');
      iframe.id = 'dev-preview';
      document.body.append(iframe);
      if (resident) iframe.src = resident.previewUrl;
      Reflect.set(globalThis, '__riftyLifecycleEvents', []);
      sandbox.runtime.on((event) => {
        if (event.type !== 'exit') return;
        (Reflect.get(globalThis, '__riftyLifecycleEvents') as RuntimeExitEvent[]).push(event);
      });
    });

    const first = await waitForMarker(page, 'hmr-a');
    expect(first.bootId).not.toBeNull();
    await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      await sandbox.fs.writeFile('/dev-hmr/src/hmr-value.js', "export const marker = 'hmr-b';\n");
    });
    const updated = await waitForMarker(page, 'hmr-b');
    expect(updated.bootId).toBe(first.bootId);
    expect(await page.evaluate(() => Reflect.get(globalThis, '__riftyWorkerCount'))).toBe(1);
    page.on('request', trackRestartRequest);

    const report = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      await sandbox.fs.writeFile('/dev-hmr/src/wedge.js', "export const wedge = 'WEDGE_NOW';\n");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const pending = sandbox.fs.writeFile(
        '/dev-hmr/src/hmr-value.js',
        "export const marker = 'stuck-write';\n",
      );
      pending.catch(() => {});
      const stayedPending = await Promise.race([
        pending.then(
          () => false,
          () => false,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 500)),
      ]);
      if (!stayedPending) throw new Error('wedge did not leave the public write pending');
      const lifecycleEvents = Reflect.get(globalThis, '__riftyLifecycleEvents') as unknown[];
      if (lifecycleEvents.length !== 0) throw new Error('wedge emitted a worker-death event');
      if (typeof sandbox.restart !== 'function') {
        throw new Error('ToolchainSandbox.restart is missing');
      }
      const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement;
      let failedRestart: unknown;
      try {
        await sandbox.restart({
          preview: iframe,
          beforeStart: async (fs) => {
            await fs.writeFile('/dev-hmr/src/wedge.js', "export const wedge = 'safe';\n");
            throw new Error('forced restart stage failure');
          },
        });
      } catch (error) {
        failedRestart = { name: (error as Error).name, message: (error as Error).message };
      }
      const restarted = await sandbox.restart({
        preview: iframe,
        beforeStart: async (fs) => {
          await fs.writeFile('/dev-hmr/src/wedge.js', "export const wedge = 'safe';\n");
          await fs.writeFile(
            '/dev-hmr/src/hmr-value.js',
            "export const marker = 'hmr-recovered';\n",
          );
        },
      });
      return {
        failedRestart,
        restarted,
        events: Reflect.get(globalThis, '__riftyLifecycleEvents'),
        iframeSrc: iframe.src,
        workerCount: Reflect.get(globalThis, '__riftyWorkerCount'),
      };
    });
    expect(report).toMatchObject({
      failedRestart: { name: 'Error', message: 'forced restart stage failure' },
      restarted: {
        unflushedWrites: true,
        resident: { port: 5174, previewUrl: '/preview/5174/' },
      },
      events: [
        { type: 'exit', reason: 'reset' },
        { type: 'exit', reason: 'reset' },
      ],
      iframeSrc: expect.stringMatching(/\/preview\/5174\/\?riftyRestart=\d+$/u),
      workerCount: 3,
    });
    expect(restartRegistryRequests).toEqual([]);

    const recovered = await waitForMarker(page, 'hmr-recovered');
    expect(recovered.bootId).not.toBe(first.bootId);
    await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      await sandbox.fs.writeFile(
        '/dev-hmr/src/hmr-value.js',
        "export const marker = 'hmr-after-restart';\n",
      );
    });
    const afterRestart = await waitForMarker(page, 'hmr-after-restart');
    expect(afterRestart.bootId).toBe(recovered.bootId);

    const clean = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const iframe = document.querySelector('#dev-preview') as HTMLIFrameElement;
      const restarted = await sandbox.restart({ preview: iframe });
      return {
        restarted,
        events: Reflect.get(globalThis, '__riftyLifecycleEvents'),
        iframeSrc: iframe.src,
        workerCount: Reflect.get(globalThis, '__riftyWorkerCount'),
      };
    });
    expect(clean).toMatchObject({
      restarted: { unflushedWrites: false },
      events: [
        { type: 'exit', reason: 'reset' },
        { type: 'exit', reason: 'reset' },
        { type: 'exit', reason: 'reset' },
      ],
      iframeSrc: expect.stringMatching(/\/preview\/5174\/\?riftyRestart=\d+$/u),
      workerCount: 4,
    });
    expect(restartRegistryRequests).toEqual([]);
  } finally {
    page.off('request', trackRestartRequest);
    await disposeSandbox(page);
  }
});

test('actual Worker close emits one runtime exit event and settles pending work', async ({
  page,
}) => {
  await bootSandbox(page);
  try {
    const outcome = await page.evaluate(async () => {
      const sandbox = Reflect.get(globalThis, '__riftyDevSandbox') as DevSandbox;
      const events: RuntimeExitEvent[] = [];
      sandbox.runtime.on((event) => {
        if (event.type === 'exit') events.push(event);
      });
      const pending = sandbox.runtime.eval('await new Promise(() => {})');
      void sandbox.runtime.eval('self.close()').catch(() => {});
      let failure: unknown;
      try {
        await pending;
      } catch (error) {
        failure = { name: (error as Error).name, message: (error as Error).message };
      }
      await Promise.resolve();
      return { events, failure };
    });
    expect(outcome).toEqual({
      events: [{ type: 'exit', reason: 'error' }],
      failure: { name: 'WorkerTerminated', message: 'Toolchain Worker closed' },
    });
  } finally {
    await disposeSandbox(page);
  }
});
