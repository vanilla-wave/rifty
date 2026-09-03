import { type Page, type Request, expect, test } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
const sdkModuleUrl = `/@fs${workspacePath}/packages/rifty/src/index.ts`;
const toolchainWorkerUrl = `/@fs${workspacePath}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;
const projectRoot = '/dev-hmr';
const port = 5174;
const startRequest = {
  cwd: projectRoot,
  binPath: `${projectRoot}/node_modules/.bin/vite`,
  args: ['--host', '127.0.0.1', '--port', String(port), '--strictPort', '--force'],
  port,
} as const;

interface FsSurface {
  writeFile(path: string, value: string): Promise<void>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

interface ResidentResult {
  readonly port: number;
  readonly previewUrl: string;
}

interface RestartReport {
  readonly unflushedWrites: boolean;
  readonly resident: ResidentResult | null;
}

interface RuntimeExitEvent {
  readonly type: string;
  readonly reason?: string;
}

interface DevSandbox {
  readonly fs: FsSurface;
  readonly runtime: {
    eval(source: string): Promise<unknown>;
    on(handler: (event: RuntimeExitEvent) => void): () => void;
  };
  readonly toolchain: {
    install(input: { cwd: string; registryUrl: string }): Promise<void>;
    startBin?(input: typeof startRequest): Promise<ResidentResult>;
  };
  readonly capabilityReport: {
    readonly features: readonly { readonly feature: string; readonly status: string }[];
  };
  restart?(options: {
    readonly preview: { src: string };
    readonly beforeStart?: (fs: FsSurface) => void | Promise<void>;
  }): Promise<RestartReport>;
  dispose(): void;
}

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

async function bootSandbox(page: Page): Promise<Page> {
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
    { sdkUrl: sdkModuleUrl, toolchainUrl: toolchainWorkerUrl },
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
      [`${projectRoot}/node_modules/.bin/vite`]:
        "#!/usr/bin/env node\nimport('../vite/server.cjs');\n",
      [`${projectRoot}/node_modules/vite/package.json`]: JSON.stringify({
        name: 'not-vite-bytes',
        version: '7.3.6',
        type: 'commonjs',
      }),
      [`${projectRoot}/node_modules/vite/server.cjs`]: `const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<output id="hmr-marker" data-boot-id="decoy">decoy-server</output>'); }).listen(port, '127.0.0.1');
`,
    });
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
    }, startRequest);
    expect(result).toEqual({ port, previewUrl: `/preview/${port}/` });
    await waitForMarker(page, 'decoy-server');
  } finally {
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
        restarted,
        events: Reflect.get(globalThis, '__riftyLifecycleEvents'),
        iframeSrc: iframe.src,
        workerCount: Reflect.get(globalThis, '__riftyWorkerCount'),
      };
    });
    expect(report).toMatchObject({
      restarted: {
        unflushedWrites: true,
        resident: { port: 5174, previewUrl: '/preview/5174/' },
      },
      events: [{ type: 'exit', reason: 'reset' }],
      iframeSrc: expect.stringMatching(/\/preview\/5174\/\?riftyRestart=\d+$/u),
      workerCount: 2,
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
      const restarted = await sandbox.restart?.({ preview: iframe });
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
      ],
      iframeSrc: expect.stringMatching(/\/preview\/5174\/\?riftyRestart=\d+$/u),
      workerCount: 3,
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
