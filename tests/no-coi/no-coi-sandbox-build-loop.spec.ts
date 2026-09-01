import { type Page, expect, test } from '@playwright/test';
import { childFsScenario } from '../../tools/perf/child-fs/scenario.mjs';
import {
  bootOwner,
  closeOwner,
  execLineOutcome,
  readOwnerFile,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from '../browser-unit/fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const sdkModuleUrl = `/@fs${workspacePath}/packages/rifty/src/index.ts`;
const runtimeWorkerUrl = `/@fs${workspacePath}/packages/runtime-js/src/worker-entry.ts`;
const toolchainWorkerUrl = `/@fs${workspacePath}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;
const coiPort = Number(process.env.RIFTY_NO_COI_ORACLE_PORT ?? 5412);
const resourcePort = Number(process.env.RIFTY_NO_COI_RESOURCE_PORT ?? 5413);
const coiBaseUrl = `http://localhost:${coiPort}`;
const marker = 'no-coi-build-parity-marker';

interface HostSnapshot {
  readonly token: string;
  readonly phase: string;
  readonly timeOrigin: number;
  readonly enteredTimeOrigin: number;
  readonly navigationCount: number;
  readonly navigationType: string | null;
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBufferType: string;
  readonly openerPresent: boolean;
  readonly imageStatus: string;
  readonly imageWidth: number;
}

interface DistFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly base64: string;
}

const expectedCapabilityReport = {
  schemaVersion: 1,
  tier: 'shared-memory-free',
  features: [
    { feature: 'fs', status: 'working' },
    { feature: 'npm.install', status: 'working' },
    { feature: 'node_modules.bin', status: 'working' },
    { feature: 'child_process.spawn.stdio', status: 'working' },
    {
      feature: 'child_process.spawn',
      status: 'degraded',
      warning: 'same-realm execution shares one event loop; first use warns once',
    },
    {
      feature: 'worker_threads.Worker',
      status: 'degraded',
      warning: 'same-realm execution has no parallelism; first use warns once',
    },
    {
      feature: 'os.parallelism',
      status: 'degraded',
      warning: 'one shared event loop; reports one available CPU',
      value: 1,
    },
    {
      feature: 'child_process.execSync',
      status: 'throwing',
      error: { name: 'NotImplementedError', feature: 'child_process.execSync' },
    },
    {
      feature: 'toolchain.threaded-wasm',
      status: 'throwing',
      error: { name: 'NotImplementedError', feature: 'toolchain.threaded-wasm' },
    },
    {
      feature: 'toolchain.dev-hmr',
      status: 'throwing',
      error: { name: 'NotImplementedError', feature: 'toolchain.dev-hmr' },
    },
  ],
} as const;

async function openHeaderlessHost(controller: Page): Promise<{
  readonly host: Page;
  readonly baseline: HostSnapshot;
}> {
  const harnessUrl = `/no-coi-harness.html?resourcePort=${resourcePort}`;
  await controller.goto(harnessUrl);
  await expect(controller.locator('#no-coi-harness')).toHaveAttribute('data-status', 'ready');
  const popupPromise = controller.waitForEvent('popup');
  await controller.evaluate(() => window.open('about:blank', `rifty-${crypto.randomUUID()}`));
  const host = await popupPromise;
  const response = await host.goto(harnessUrl);
  expect(response).not.toBeNull();
  if (response === null) throw new Error('headerless host navigation returned no response');
  const headers = await response.allHeaders();
  expect(headers['cross-origin-opener-policy']).toBeUndefined();
  expect(headers['cross-origin-embedder-policy']).toBeUndefined();
  await expect(host.locator('#no-coi-harness')).toHaveAttribute('data-status', 'ready');
  await expect(host.locator('#cross-origin-probe')).toHaveAttribute('data-status', 'loaded');
  expect(
    await host.evaluate(async () => {
      const api = Reflect.get(globalThis, '__riftyNoCoiHost') as {
        openerRoundTrip(): Promise<boolean>;
      };
      return api.openerRoundTrip();
    }),
  ).toBe(true);
  const baseline = await hostSnapshot(host);
  assertHostSnapshot(baseline, baseline);
  return { host, baseline };
}

function hostSnapshot(page: Page): Promise<HostSnapshot> {
  return page.evaluate(() => {
    const api = Reflect.get(globalThis, '__riftyNoCoiHost') as {
      snapshot(): HostSnapshot;
    };
    return api.snapshot();
  });
}

function hostSamples(page: Page): Promise<readonly HostSnapshot[]> {
  return page.evaluate(() => {
    const api = Reflect.get(globalThis, '__riftyNoCoiHost') as {
      samples(): readonly HostSnapshot[];
    };
    return api.samples();
  });
}

async function setHostPhase(page: Page, phase: string): Promise<void> {
  await page.evaluate((next) => {
    const api = Reflect.get(globalThis, '__riftyNoCoiHost') as {
      setPhase(phase: string): void;
    };
    api.setPhase(next);
  }, phase);
}

function openerRoundTrip(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const api = Reflect.get(globalThis, '__riftyNoCoiHost') as {
      openerRoundTrip(): Promise<boolean>;
    };
    return api.openerRoundTrip();
  });
}

async function renewCrossOriginImage(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const image = document.getElementById('cross-origin-probe') as HTMLImageElement | null;
    if (image === null) throw new Error('cross-origin probe image is missing');
    image.dataset.status = 'loading';
    const loaded = new Promise<string>((resolve) => {
      image.addEventListener('load', () => resolve('loaded'), { once: true });
      image.addEventListener('error', () => resolve('error'), { once: true });
    });
    const next = new URL(image.src);
    next.search = crypto.randomUUID();
    image.src = next.href;
    const outcome = await loaded;
    image.dataset.status = outcome;
    return outcome;
  });
  expect(status).toBe('loaded');
}

function assertHostCore(actual: HostSnapshot, baseline: HostSnapshot): void {
  expect(actual.token).toBe(baseline.token);
  expect(actual.timeOrigin).toBe(baseline.enteredTimeOrigin);
  expect(actual.enteredTimeOrigin).toBe(baseline.enteredTimeOrigin);
  expect(actual.navigationCount).toBe(1);
  expect(actual.navigationType).toBe('navigate');
  expect(actual.crossOriginIsolated).toBe(false);
  expect(actual.sharedArrayBufferType).toBe('undefined');
  expect(actual.openerPresent).toBe(true);
}

function assertHostSnapshot(actual: HostSnapshot, baseline: HostSnapshot): void {
  assertHostCore(actual, baseline);
  expect(actual.imageStatus).toBe('loaded');
  expect(actual.imageWidth).toBeGreaterThan(0);
}

async function waitForRuntimeReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const holder = globalThis as typeof globalThis & {
      __riftyNoCoiSandbox?: { runtime: { isReady(): boolean; on(fn: () => void): () => void } };
    };
    const runtime = holder.__riftyNoCoiSandbox?.runtime;
    if (!runtime) throw new Error('sandbox is not stored');
    if (runtime.isReady()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('runtime ready timeout')), 30_000);
      const off = runtime.on(() => {
        if (!runtime.isReady()) return;
        clearTimeout(timer);
        off();
        resolve();
      });
    });
  });
}

async function createGenericSandbox(page: Page): Promise<{
  readonly defaultError: { readonly name: string; readonly message: string };
  readonly text: string;
  readonly evalOk: boolean;
  readonly stdout: string;
}> {
  const result = await page.evaluate(
    async ({ sdkUrl, workerUrl }) => {
      const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
        createSandbox(options: Record<string, unknown>): Promise<unknown>;
      };
      let defaultError: { name: string; message: string } | null = null;
      try {
        await sdk.createSandbox({ workerUrl, skipServiceWorker: true });
      } catch (error) {
        const inspected = error instanceof Error ? error : new Error(String(error));
        defaultError = { name: inspected.name, message: inspected.message };
      }
      if (defaultError === null) throw new Error('default no-COI admission unexpectedly booted');
      const sandbox = (await sdk.createSandbox({
        workerUrl,
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
      })) as {
        runtime: {
          eval(source: string): Promise<{ ok: boolean }>;
          isReady(): boolean;
          on(fn: (event: { type: string; chunk?: string }) => void): () => void;
        };
        fs: {
          writeFile(path: string, value: string): Promise<void>;
          readFile(path: string, encoding: 'utf8'): Promise<string>;
        };
        dispose(): void;
      };
      const holder = globalThis as typeof globalThis & {
        __riftyNoCoiSandbox?: unknown;
        __riftyNoCoiDefaultError?: { name: string; message: string };
      };
      holder.__riftyNoCoiSandbox = sandbox;
      holder.__riftyNoCoiDefaultError = defaultError;
      const stdout: string[] = [];
      sandbox.runtime.on((event) => {
        if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
      });
      return { defaultError, stored: true, stdout };
    },
    { sdkUrl: sdkModuleUrl, workerUrl: runtimeWorkerUrl },
  );
  expect(result.stored).toBe(true);
  await waitForRuntimeReady(page);
  return page.evaluate(async (seed) => {
    const holder = globalThis as typeof globalThis & {
      __riftyNoCoiSandbox: {
        runtime: {
          eval(source: string): Promise<{ ok: boolean }>;
          on(fn: (event: { type: string; chunk?: string }) => void): () => void;
        };
        fs: {
          writeFile(path: string, value: string): Promise<void>;
          readFile(path: string, encoding: 'utf8'): Promise<string>;
        };
      };
      __riftyNoCoiDefaultError: { name: string; message: string };
    };
    const sandbox = (
      globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          runtime: {
            eval(source: string): Promise<{ ok: boolean }>;
            on(fn: (event: { type: string; chunk?: string }) => void): () => void;
          };
          fs: {
            writeFile(path: string, value: string): Promise<void>;
            readFile(path: string, encoding: 'utf8'): Promise<string>;
          };
        };
      }
    ).__riftyNoCoiSandbox;
    const stdout: string[] = [];
    const off = sandbox.runtime.on((event) => {
      if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
    });
    await sandbox.fs.writeFile('/preservation/value.txt', seed);
    const text = await sandbox.fs.readFile('/preservation/value.txt', 'utf8');
    const evaluated = await sandbox.runtime.eval(
      "console.log('generic-no-coi:' + require('node:fs').readFileSync('/preservation/value.txt', 'utf8'))",
    );
    off();
    return {
      defaultError: holder.__riftyNoCoiDefaultError,
      text,
      evalOk: evaluated.ok,
      stdout: stdout.join(''),
    };
  }, 'public-worker');
}

async function createToolchainSandbox(page: Page): Promise<{
  readonly hasToolchain: boolean;
  readonly installType: string;
  readonly runBinType: string;
  readonly report: unknown;
  readonly reportFrozen: boolean;
  readonly reportDeepFrozen: boolean;
}> {
  const state = await page.evaluate(
    async ({ sdkUrl, genericWorkerUrl, selectedToolchainWorkerUrl }) => {
      const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
        createSandbox(options: Record<string, unknown>): Promise<unknown>;
      };
      const sandbox = (await sdk.createSandbox({
        workerUrl: genericWorkerUrl,
        requireCrossOriginIsolation: false,
        serviceWorkerUrl: '/sw.js',
        toolchain: { workerUrl: selectedToolchainWorkerUrl },
      })) as Record<string, unknown> & {
        runtime: { isReady(): boolean; on(fn: () => void): () => void };
        dispose(): void;
      };
      (globalThis as typeof globalThis & { __riftyNoCoiSandbox?: unknown }).__riftyNoCoiSandbox =
        sandbox;
      const toolchain = sandbox.toolchain as Record<string, unknown> | undefined;
      const report = sandbox.capabilityReport;
      const features =
        typeof report === 'object' && report !== null ? Reflect.get(report, 'features') : undefined;
      const deepFrozen = (value: unknown): boolean => {
        if (typeof value !== 'object' || value === null) return true;
        if (!Object.isFrozen(value)) return false;
        return Object.values(value).every(deepFrozen);
      };
      return {
        hasToolchain: toolchain !== undefined,
        installType: typeof toolchain?.install,
        runBinType: typeof toolchain?.runBin,
        report,
        reportFrozen: typeof report === 'object' && report !== null && Object.isFrozen(report),
        reportDeepFrozen: Array.isArray(features) && deepFrozen(report),
      };
    },
    {
      sdkUrl: sdkModuleUrl,
      genericWorkerUrl: runtimeWorkerUrl,
      selectedToolchainWorkerUrl: toolchainWorkerUrl,
    },
  );
  await waitForRuntimeReady(page);
  return state;
}

async function disposeSandbox(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = globalThis as typeof globalThis & {
      __riftyNoCoiSandbox?: { dispose(): void };
    };
    holder.__riftyNoCoiSandbox?.dispose();
    holder.__riftyNoCoiSandbox = undefined;
  });
}

function panelWithMarker(source: string): string {
  const replaced = source.replaceAll('bench-seed', marker);
  if (replaced === source || replaced.split(marker).length !== 3) {
    throw new Error('canonical Panel marker sites drifted');
  }
  return replaced;
}

function assertCommandSuccess(
  outcome: Awaited<ReturnType<typeof execLineOutcome>>,
  label: string,
): void {
  expect(outcome.exitCode, `${label} exitCode`).toBe(0);
  expect(outcome.exit, `${label} exit`).toEqual({ code: 0, signal: null });
  expect(outcome.closeExit, `${label} close`).toEqual({ code: 0, signal: null });
  expect(outcome.closeShared, `${label} shared close`).toBe(true);
  expect(outcome.settlements, `${label} settlements`).toBe(1);
}

async function collectProjectDist(page: Page): Promise<readonly DistFile[]> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const files = fixture.currentProject().files;
    const paths: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await files.readdir(directory);
      for (const entry of entries) {
        if (entry.kind === 'dir') await walk(entry.path);
        else paths.push(entry.path);
      }
    };
    await walk('/dist');
    const hex = (bytes: Uint8Array): string =>
      [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const base64 = (bytes: Uint8Array): string => {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    };
    return Promise.all(
      paths.toSorted().map(async (path) => {
        const read = await files.readFile(path);
        const bytes = read.bytes as Uint8Array;
        const owned = new Uint8Array(bytes.byteLength);
        owned.set(bytes);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned));
        return {
          path: path.slice('/dist/'.length),
          size: bytes.byteLength,
          sha256: hex(digest),
          base64: base64(bytes),
        };
      }),
    );
  }, sealedWorkbenchFixtureUrl);
}

async function runCoiProduct(
  page: Page,
  onOpened: () => void,
): Promise<{
  readonly dist: readonly DistFile[];
  readonly output: string;
}> {
  const scenario = childFsScenario();
  await page.goto(`${coiBaseUrl}/unit-harness.html`);
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
  await bootOwner(page, {
    workspaceId: `no-coi-build-oracle-${crypto.randomUUID()}`,
    persistence: 'ephemeral',
    plan: {
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'no-coi-build-oracle',
      templateId: 'no-coi-build-oracle-v1',
      files: scenario.files,
      dependencies: scenario.dependencies,
      firstMaterialization: { kind: 'install' },
      entryPath: '/express-anchor.cjs',
    },
  });
  onOpened();
  const install = await execLineOutcome(page, 'npm install');
  assertCommandSuccess(install, 'COI npm install');
  for (const [dependency, version] of Object.entries(scenario.dependencies)) {
    const manifest = await readOwnerFile(page, `/scratch/node_modules/${dependency}/package.json`);
    expect(manifest.ok, manifest.error).toBe(true);
    expect(JSON.parse(manifest.text)).toMatchObject({ version });
  }
  const panel = scenario.files['/src/Panel.jsx'];
  if (panel === undefined) throw new Error('canonical Panel is missing');
  await writeOwnerFile(page, '/scratch/src/Panel.jsx', panelWithMarker(panel));
  const build = await execLineOutcome(page, 'vite build');
  assertCommandSuccess(build, 'COI vite build');
  expect((build.out.match(/2180 modules transformed\./gu) ?? []).length).toBe(1);
  return { dist: await collectProjectDist(page), output: build.out };
}

async function runNoCoiProduct(page: Page): Promise<{
  readonly dist: readonly DistFile[];
  readonly output: string;
  readonly exitCode: number;
  readonly esbuildAdmission: unknown;
}> {
  const scenario = childFsScenario();
  await page.evaluate(
    async ({ files, root }) => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            fs: { writeFile(path: string, value: string): Promise<void> };
          };
        }
      ).__riftyNoCoiSandbox;
      for (const [path, source] of Object.entries(files)) {
        await sandbox.fs.writeFile(`${root}${path}`, source);
      }
    },
    { files: scenario.files, root: '/project' },
  );
  await setHostPhase(page, 'install');
  await page.evaluate(async () => {
    const sandbox = (
      globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          toolchain: { install(input: Record<string, unknown>): Promise<void> };
        };
      }
    ).__riftyNoCoiSandbox;
    await sandbox.toolchain.install({ cwd: '/project', registryUrl: '/npm-registry' });
  });
  const esbuildAdmission = await page.evaluate(async () => {
    const sandbox = (
      globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          fs: { readFile(path: string, encoding: 'utf8'): Promise<string> };
        };
      }
    ).__riftyNoCoiSandbox;
    const lock = JSON.parse(await sandbox.fs.readFile('/project/package-lock.json', 'utf8'));
    const trace = lock.rifty?.shadowSubstitutions;
    const recipe = trace?.applied?.find(
      (candidate: Record<string, unknown>) =>
        (candidate.materialization as { name?: unknown } | undefined)?.name === 'esbuild',
    );
    return {
      protocol: trace?.protocol,
      substitutionId: recipe?.substitutionId,
      catalog: recipe?.catalog,
      recipeDigest: recipe?.recipeDigest,
      materialization: recipe?.materialization,
      lockEntry: lock.packages?.['node_modules/esbuild'],
    };
  });
  expect(await openerRoundTrip(page)).toBe(true);
  await renewCrossOriginImage(page);
  for (const [dependency, version] of Object.entries(scenario.dependencies)) {
    const installed = await page.evaluate(
      async ({ path }) => {
        const sandbox = (
          globalThis as typeof globalThis & {
            __riftyNoCoiSandbox: {
              fs: { readFile(path: string, encoding: 'utf8'): Promise<string> };
            };
          }
        ).__riftyNoCoiSandbox;
        return sandbox.fs.readFile(path, 'utf8');
      },
      { path: `/project/node_modules/${dependency}/package.json` },
    );
    expect(JSON.parse(installed)).toMatchObject({ version });
  }
  const panel = scenario.files['/src/Panel.jsx'];
  if (panel === undefined) throw new Error('canonical Panel is missing');
  await page.evaluate(
    async ({ source }) => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: { fs: { writeFile(path: string, value: string): Promise<void> } };
        }
      ).__riftyNoCoiSandbox;
      await sandbox.fs.writeFile('/project/src/Panel.jsx', source);
    },
    { source: panelWithMarker(panel) },
  );
  await setHostPhase(page, 'build');
  const build = await page.evaluate(async () => {
    const sandbox = (
      globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          runtime: { on(fn: (event: { type: string; chunk?: string }) => void): () => void };
          toolchain: {
            runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
          };
        };
      }
    ).__riftyNoCoiSandbox;
    const output: string[] = [];
    const off = sandbox.runtime.on((event) => {
      if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk) {
        output.push(event.chunk);
      }
    });
    try {
      const result = await sandbox.toolchain.runBin({
        cwd: '/project',
        binPath: '/project/node_modules/.bin/vite',
        args: ['build'],
      });
      return { ...result, output: output.join('') };
    } finally {
      off();
    }
  });
  expect(await openerRoundTrip(page)).toBe(true);
  await renewCrossOriginImage(page);
  const paths = await page.evaluate(async () => {
    const sandbox = (
      globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          runtime: {
            eval(source: string): Promise<{ ok: boolean }>;
            on(fn: (event: { type: string; chunk?: string }) => void): () => void;
          };
        };
      }
    ).__riftyNoCoiSandbox;
    const output: string[] = [];
    const off = sandbox.runtime.on((event) => {
      if (event.type === 'stdout' && event.chunk) output.push(event.chunk);
    });
    const result = await sandbox.runtime.eval(`
      (() => {
        const fs = require('node:fs');
        const path = require('node:path');
        const walk = (dir) => fs.readdirSync(dir).flatMap((name) => {
          const target = path.join(dir, name);
          return fs.statSync(target).isDirectory() ? walk(target) : [target];
        });
        console.log('__RIFTY_DIST__' + JSON.stringify(walk('/project/dist').sort()));
      })()
    `);
    off();
    if (!result.ok) throw new Error(`dist inventory eval failed: ${output.join('')}`);
    const line = output
      .join('')
      .split('\n')
      .find((entry) => entry.startsWith('__RIFTY_DIST__'));
    if (!line) throw new Error('dist inventory marker missing');
    return JSON.parse(line.slice('__RIFTY_DIST__'.length)) as string[];
  });
  const dist = await page.evaluate(async (absolutePaths) => {
    const sandbox = (
      globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: { fs: { readFile(path: string): Promise<Uint8Array> } };
      }
    ).__riftyNoCoiSandbox;
    const hex = (bytes: Uint8Array): string =>
      [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const base64 = (bytes: Uint8Array): string => {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    };
    return Promise.all(
      absolutePaths.map(async (path) => {
        const bytes = await sandbox.fs.readFile(path);
        const owned = new Uint8Array(bytes.byteLength);
        owned.set(bytes);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned));
        return {
          path: path.slice('/project/dist/'.length),
          size: bytes.byteLength,
          sha256: hex(digest),
          base64: base64(bytes),
        };
      }),
    );
  }, paths);
  return { dist, output: build.output, exitCode: build.exitCode, esbuildAdmission };
}

test('preservation: real public createSandbox stays headerless and keeps opener/subresource/eval/fs', async ({
  page,
}) => {
  const { host, baseline } = await openHeaderlessHost(page);
  try {
    await setHostPhase(host, 'generic-create');
    const result = await createGenericSandbox(host);
    expect(result.defaultError.name).toBe('Error');
    expect(result.defaultError.message).toContain('cross-origin isolation is not active');
    expect(result.defaultError.message).toContain('requireCrossOriginIsolation: false');
    expect(result.text).toBe('public-worker');
    expect(result.evalOk).toBe(true);
    expect(result.stdout).toContain('generic-no-coi:public-worker');
    assertHostSnapshot(await hostSnapshot(host), baseline);
    expect(
      await host.evaluate(async () => {
        const api = Reflect.get(globalThis, '__riftyNoCoiHost') as {
          openerRoundTrip(): Promise<boolean>;
        };
        return api.openerRoundTrip();
      }),
    ).toBe(true);
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('capability and no-COI degradation contract — designed RED', async ({ page }) => {
  const { host, baseline } = await openHeaderlessHost(page);
  try {
    const state = await createToolchainSandbox(host);
    expect(state.report).toEqual(expectedCapabilityReport);
    expect(state).toMatchObject({
      hasToolchain: true,
      installType: 'function',
      runBinType: 'function',
      reportFrozen: true,
      reportDeepFrozen: true,
    });
    const surfaces = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            runtime: {
              eval(source: string): Promise<{ ok: boolean }>;
              on(fn: (event: { type: string; chunk?: string }) => void): () => void;
            };
            fs: { writeFile(path: string, value: string): Promise<void> };
          };
        }
      ).__riftyNoCoiSandbox;
      await sandbox.fs.writeFile(
        '/project/child.cjs',
        "console.log('child-console'); console.error('child-error')\n",
      );
      await sandbox.fs.writeFile('/project/thread.cjs', "console.log('thread-console')\n");
      const stdout: string[] = [];
      const stderr: string[] = [];
      const off = sandbox.runtime.on((event) => {
        if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
        if (event.type === 'stderr' && event.chunk) stderr.push(event.chunk);
      });
      const result = await sandbox.runtime.eval(`
        (async () => {
          const cp = require('node:child_process');
          const os = require('node:os');
          const wt = require('node:worker_threads');
          const run = () => new Promise((resolve, reject) => {
            const child = cp.spawn('node', ['/project/child.cjs']);
            let out = ''; let err = '';
            child.stdout.on('data', (chunk) => { out += chunk; });
            child.stderr.on('data', (chunk) => { err += chunk; });
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal, out, err }));
          });
          const first = await run();
          const second = await run();
          const thread = await new Promise((resolve, reject) => {
            const worker = new wt.Worker('/project/thread.cjs');
            worker.once('error', reject);
            worker.once('exit', (code) => resolve({ code }));
          });
          let execSync;
          try { cp.execSync('node /project/child.cjs'); }
          catch (error) { execSync = { name: error.name, feature: error.feature }; }
          let sharedWasm;
          try { new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }); }
          catch (error) {
            sharedWasm = { name: error.name, feature: error.feature, message: error.message };
          }
          const privateWasmBytes = new WebAssembly.Memory({ initial: 1 }).buffer.byteLength;
          console.log('__RIFTY_SURFACES__' + JSON.stringify({
            first, second, thread, cpus: os.cpus().length,
            parallelism: os.availableParallelism(), execSync, sharedWasm, privateWasmBytes,
          }));
        })()
      `);
      off();
      const line = stdout
        .join('')
        .split('\n')
        .find((entry) => entry.startsWith('__RIFTY_SURFACES__'));
      return {
        evalOk: result.ok,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        value: line ? JSON.parse(line.slice('__RIFTY_SURFACES__'.length)) : null,
      };
    });
    expect(surfaces.evalOk).toBe(true);
    expect(surfaces.value).toEqual({
      first: { code: 0, signal: null, out: 'child-console\n', err: 'child-error\n' },
      second: { code: 0, signal: null, out: 'child-console\n', err: 'child-error\n' },
      thread: { code: 0 },
      cpus: 1,
      parallelism: 1,
      execSync: { name: 'NotImplementedError', feature: 'child_process.execSync' },
      sharedWasm: expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'toolchain.threaded-wasm',
      }),
      privateWasmBytes: 65_536,
    });
    expect((surfaces.stderr.match(/\[rifty:child_process\].*same-realm/gu) ?? []).length).toBe(1);
    expect((surfaces.stderr.match(/\[rifty:worker_threads\].*same-realm/gu) ?? []).length).toBe(1);
    assertHostSnapshot(await hostSnapshot(host), baseline);
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('build parity: headerless SDK dist equals live COI product bytes — designed RED', async ({
  browser,
  page,
}) => {
  const coiPage = await browser.newPage();
  let ownerOpened = false;
  try {
    const coi = await runCoiProduct(coiPage, () => {
      ownerOpened = true;
    });
    const { host, baseline } = await openHeaderlessHost(page);
    try {
      const state = await createToolchainSandbox(host);
      expect(state).toMatchObject({
        hasToolchain: true,
        installType: 'function',
        runBinType: 'function',
      });
      const noCoi = await runNoCoiProduct(host);
      expect(noCoi.exitCode).toBe(0);
      expect((noCoi.output.match(/2180 modules transformed\./gu) ?? []).length).toBe(1);
      expect(noCoi.dist).toEqual(coi.dist);
      expect(noCoi.esbuildAdmission).toMatchObject({
        protocol: 'rifty.shadow-substitutions/v2',
        substitutionId: 'rifty.shadow-substitution.esbuild.v2',
        catalog: {
          id: 'rifty.shadow-substitutions.builtin.v2',
          digest: '16169d78ba50a3ded324cee63fe9296dcb4884007e25730dfee78114730395f6',
        },
        recipeDigest: 'b17f55f3d5905344b927c47c4b6fc9faacb122829150d603cb73a006bcbcfc28',
        materialization: {
          installPath: 'node_modules/esbuild',
          name: 'esbuild',
          version: '0.28.0',
          bin: { esbuild: 'bin/esbuild' },
        },
        lockEntry: {
          version: '0.28.0',
          bin: { esbuild: 'bin/esbuild' },
          riftyShadowRecipe: 'rifty.shadow-substitution.esbuild.v2',
        },
      });
      const js = noCoi.dist.filter(({ path }) => path.endsWith('.js'));
      expect(js).toHaveLength(1);
      expect(atob(js[0]?.base64 ?? '').split(marker).length - 1).toBe(2);
      await setHostPhase(host, 'after-build');
      const samples = await hostSamples(host);
      expect(samples.some(({ phase }) => phase === 'install')).toBe(true);
      expect(samples.some(({ phase }) => phase === 'build')).toBe(true);
      for (const sample of samples) assertHostCore(sample, baseline);
      assertHostSnapshot(await hostSnapshot(host), baseline);
      expect(await openerRoundTrip(host)).toBe(true);
      await renewCrossOriginImage(host);
      expect(coi.output).toContain('2180 modules transformed.');
    } finally {
      await disposeSandbox(host);
      await host.close();
    }
  } finally {
    if (ownerOpened) await closeOwner(coiPage);
    await coiPage.close();
  }
});

test('threaded-WASM: Vite 8 Rolldown fails at named boundary — designed RED', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const state = await createToolchainSandbox(host);
    expect(state).toMatchObject({
      hasToolchain: true,
      installType: 'function',
      runBinType: 'function',
    });
    const failure = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            fs: {
              writeFile(path: string, value: string): Promise<void>;
              readFile(path: string, encoding: 'utf8'): Promise<string>;
            };
            toolchain: {
              install(input: Record<string, unknown>): Promise<void>;
              runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
            };
          };
        }
      ).__riftyNoCoiSandbox;
      const root = '/vite8';
      await sandbox.fs.writeFile(
        `${root}/package.json`,
        JSON.stringify({
          name: 'vite8-boundary',
          private: true,
          type: 'module',
          dependencies: { vite: '8.0.16' },
        }),
      );
      await sandbox.fs.writeFile(
        `${root}/index.html`,
        '<script type="module" src="/src.js"></script>',
      );
      await sandbox.fs.writeFile(`${root}/src.js`, "document.body.textContent='vite8';\n");
      await sandbox.toolchain.install({ cwd: root, registryUrl: '/npm-registry' });
      try {
        await sandbox.toolchain.runBin({
          cwd: root,
          binPath: `${root}/node_modules/.bin/vite`,
          args: ['build'],
        });
        return { threw: false };
      } catch (error) {
        const inspected = error as Error & { feature?: string };
        let dist: string;
        try {
          await sandbox.fs.readFile(`${root}/dist/index.html`, 'utf8');
          dist = 'present';
        } catch {
          dist = 'absent';
        }
        return {
          threw: true,
          name: inspected.name,
          feature: inspected.feature,
          message: inspected.message,
          dist,
        };
      }
    });
    expect(failure).toMatchObject({
      threw: true,
      name: 'NotImplementedError',
      feature: 'toolchain.threaded-wasm',
      dist: 'absent',
    });
    expect(failure.message).toMatch(/Vite 8\.0\.16/i);
    expect(failure.message).toMatch(/Rolldown/i);
    expect(failure.message).toMatch(/WASI/i);
    expect(failure.message).toMatch(/pthread/i);
    expect(failure.message).toMatch(/SharedArrayBuffer/i);
    expect(failure.message).toMatch(/cross-origin isolation/i);
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

async function seedStalledInstall(page: Page, root: string): Promise<void> {
  await page.evaluate(
    async ({ projectRoot }) => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: { fs: { writeFile(path: string, value: string): Promise<void> } };
        }
      ).__riftyNoCoiSandbox;
      await sandbox.fs.writeFile(
        `${projectRoot}/package.json`,
        JSON.stringify({
          name: 'stalled-install',
          private: true,
          dependencies: { kleur: '4.1.5' },
        }),
      );
    },
    { projectRoot: root },
  );
}

async function beginStalledInstall(page: Page, root: string): Promise<void> {
  const admitted = page.waitForRequest((request) =>
    new URL(request.url()).pathname.startsWith('/__no-coi-stall-registry/'),
  );
  await page.evaluate(
    ({ projectRoot }) => {
      const holder = globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          toolchain: { install(input: Record<string, unknown>): Promise<void> };
        };
        __riftyPendingToolchain?: Promise<void>;
      };
      const operation = holder.__riftyNoCoiSandbox.toolchain.install({
        cwd: projectRoot,
        registryUrl: '/__no-coi-stall-registry',
      });
      operation.catch(() => {});
      holder.__riftyPendingToolchain = operation;
    },
    { projectRoot: root },
  );
  await admitted;
}

test('toolchain overlap rejects instead of racing or queuing — designed RED', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const state = await createToolchainSandbox(host);
    expect(state.installType).toBe('function');
    await seedStalledInstall(host, '/overlap');
    const malformed = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            fs: { readFile(path: string, encoding: 'utf8'): Promise<string> };
            toolchain: { runBin(input: Record<string, unknown>): Promise<unknown> };
          };
        }
      ).__riftyNoCoiSandbox;
      const before = await sandbox.fs.readFile('/overlap/package.json', 'utf8');
      let failure: { name: string; message: string } | null = null;
      try {
        await sandbox.toolchain.runBin({
          cwd: '/overlap',
          binPath: '/overlap/node_modules/.bin/vite',
          args: 'build',
        });
      } catch (error) {
        const inspected = error instanceof Error ? error : new Error(String(error));
        failure = { name: inspected.name, message: inspected.message };
      }
      const after = await sandbox.fs.readFile('/overlap/package.json', 'utf8');
      return { before, after, failure };
    });
    expect(malformed.failure).toMatchObject({ name: 'TypeError' });
    expect(malformed.after).toBe(malformed.before);
    await beginStalledInstall(host, '/overlap');
    const outcome = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            toolchain: { install(input: Record<string, unknown>): Promise<void> };
          };
        }
      ).__riftyNoCoiSandbox;
      let second: { name: string; message: string } | null = null;
      try {
        await sandbox.toolchain.install({
          cwd: '/overlap',
          registryUrl: '/__no-coi-stall-registry',
        });
      } catch (error) {
        const inspected = error instanceof Error ? error : new Error(String(error));
        second = { name: inspected.name, message: inspected.message };
      }
      return second;
    });
    expect(outcome).toMatchObject({ name: 'SandboxToolchainBusyError' });
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('toolchain disposal rejects the admitted request without a hang — designed RED', async ({
  page,
}) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const state = await createToolchainSandbox(host);
    expect(state.installType).toBe('function');
    await seedStalledInstall(host, '/dispose');
    await beginStalledInstall(host, '/dispose');
    const outcome = await host.evaluate(async () => {
      const holder = globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          dispose(): void;
        };
        __riftyPendingToolchain?: Promise<void>;
      };
      const installing = holder.__riftyPendingToolchain;
      if (installing === undefined) throw new Error('admitted install promise is missing');
      holder.__riftyNoCoiSandbox.dispose();
      try {
        await Promise.race([
          installing,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('settlement timeout')), 5000),
          ),
        ]);
        return { resolved: true };
      } catch (error) {
        const inspected = error as Error & { code?: string };
        return {
          resolved: false,
          name: inspected.name,
          code: inspected.code,
          message: inspected.message,
        };
      }
    });
    expect(outcome).toMatchObject({ resolved: false, name: 'WorkerTerminated' });
    expect(outcome.message).not.toContain('settlement timeout');
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});
