import { type Page, type Route, expect, test } from '@playwright/test';
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
const sdkIoModuleUrl = `/@fs${workspacePath}/packages/rifty/src/io.ts`;
const sdkVfsModuleUrl = `/@fs${workspacePath}/packages/rifty/src/vfs.ts`;
const runtimeWorkerUrl = `/@fs${workspacePath}/packages/runtime-js/src/worker-entry.ts`;
const toolchainWorkerUrl = `/@fs${workspacePath}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;
const memoryIdentityWorkerUrl = `/@fs${workspacePath}/tests/no-coi/fixtures/toolchain-memory-identity-worker.ts`;
const coiPort = Number(process.env.RIFTY_NO_COI_ORACLE_PORT ?? 5412);
const resourcePort = Number(process.env.RIFTY_NO_COI_RESOURCE_PORT ?? 5413);
const coiBaseUrl = `http://localhost:${coiPort}`;
const marker = 'no-coi-build-parity-marker';

function moduleTransformLines(output: string): readonly string[] {
  const escape = String.fromCharCode(27);
  const ansi = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'gu');
  const lineRestart = new RegExp(`${escape}\\[(?:1)?G`, 'gu');
  return output
    .replace(/\r\n/gu, '\n')
    .replaceAll('\r', '\n')
    .replace(lineRestart, '\n')
    .replace(ansi, '')
    .split('\n')
    .filter((line) => line.includes('modules transformed.'));
}

const threadedWasmProbeExpression = `(() => {
  const NativeMemory = globalThis.WebAssembly.Memory;
  const inherited = Object.assign(Object.create({ shared: true }), { initial: 1 });
  const accessor = Object.defineProperties({}, {
    initial: { value: 1, enumerable: true },
    shared: { get: () => true, enumerable: true },
  });
  const callable = Object.assign(function memoryDescriptor() {}, {
    initial: 1,
    maximum: 1,
    shared: true,
  });
  const shared = [
    ['own-literal-true', { initial: 1, shared: true }],
    ['inherited-literal-true', inherited],
    ['accessor-literal-true', accessor],
    ['own-truthy-number', { initial: 1, shared: 1 }],
    ['own-truthy-string', { initial: 1, shared: 'yes' }],
    ['callable-literal-true', callable],
  ].map(([form, descriptor]) => {
    try {
      new WebAssembly.Memory(descriptor);
      return { form, name: 'resolved' };
    } catch (error) {
      return { form, name: error.name, feature: error.feature };
    }
  });
  const memory = new WebAssembly.Memory({ initial: 1 });
  return {
    shared,
    identity: {
      globalConstructorUnchanged: globalThis.WebAssembly.Memory === NativeMemory,
      instanceConstructorUnchanged: memory.constructor === NativeMemory,
      prototypeUnchanged: Object.getPrototypeOf(memory) === NativeMemory.prototype,
      bytes: memory.buffer.byteLength,
    },
  };
})()`;

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

interface HostPostureObservation {
  readonly method: string;
  readonly url: string;
  readonly secFetchMode: string | null;
  readonly secFetchSite: string | null;
  readonly cookie: string | null;
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
    { feature: 'toolchain.dev-hmr', status: 'working' },
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

async function assertCrossOriginSubresource(
  page: Page,
  baseline: HostSnapshot,
  phase: string,
): Promise<void> {
  const expectedOrigin = `http://127.0.0.1:${resourcePort}`;
  if (phase === 'before-boot') {
    const seed = await page.request.get(
      `${expectedOrigin}/__no-coi-host-resource-seed?probe=${encodeURIComponent(baseline.token)}`,
    );
    expect(seed.status()).toBe(204);
  }
  const responsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.origin === expectedOrigin &&
        url.pathname === '/__no-coi-host-resource.svg' &&
        url.searchParams.get('probe') === baseline.token &&
        url.searchParams.get('phase') === phase
      );
    },
    { timeout: 5000 },
  );
  const status = await page.evaluate(
    async ({ nextPhase, probe }) => {
      const image = document.getElementById('cross-origin-probe') as HTMLImageElement | null;
      if (image === null) throw new Error('cross-origin probe image is missing');
      image.dataset.status = 'loading';
      const loaded = new Promise<string>((resolve) => {
        image.addEventListener('load', () => resolve('loaded'), { once: true });
        image.addEventListener('error', () => resolve('error'), { once: true });
      });
      const next = new URL(image.src);
      next.pathname = '/__no-coi-host-resource.svg';
      next.search = '';
      next.searchParams.set('probe', probe);
      next.searchParams.set('phase', nextPhase);
      next.searchParams.set('nonce', crypto.randomUUID());
      image.src = next.href;
      const outcome = await loaded;
      image.dataset.status = outcome;
      return outcome;
    },
    { nextPhase: phase, probe: baseline.token },
  );
  expect(status).toBe('loaded');
  const response = await responsePromise;
  expect(response.request().resourceType()).toBe('image');
  const responseHeaders = await response.allHeaders();
  expect(responseHeaders['access-control-allow-origin']).toBeUndefined();
  expect(responseHeaders['cross-origin-resource-policy']).toBeUndefined();
  expect(responseHeaders['cross-origin-opener-policy']).toBeUndefined();
  expect(responseHeaders['cross-origin-embedder-policy']).toBeUndefined();

  const receipt = await page.request.get(
    `${expectedOrigin}/__no-coi-host-resource-receipt?probe=${encodeURIComponent(baseline.token)}&phase=${encodeURIComponent(phase)}`,
  );
  expect(receipt.ok()).toBe(true);
  const observation = (await receipt.json()) as HostPostureObservation | null;
  expect(observation).toEqual({
    method: 'GET',
    url: expect.stringContaining(
      `/__no-coi-host-resource.svg?probe=${baseline.token}&phase=${phase}`,
    ),
    secFetchMode: 'no-cors',
    secFetchSite: 'same-site',
    cookie: expect.stringContaining(`rifty_no_coi_sentinel=${baseline.token}`),
  });
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
  readonly expectedCoiMessage: string;
  readonly text: string;
  readonly evalOk: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly hasToolchain: boolean;
  readonly hasCapabilityReport: boolean;
  readonly cpu: { readonly cpus: number; readonly parallelism: number; readonly hardware: number };
}> {
  const result = await page.evaluate(
    async ({ sdkUrl, workerUrl }) => {
      const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
        COI_REQUIRED_MESSAGE: string;
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
      return {
        defaultError,
        expectedCoiMessage: sdk.COI_REQUIRED_MESSAGE,
        stored: true,
        stdout,
      };
    },
    { sdkUrl: sdkModuleUrl, workerUrl: runtimeWorkerUrl },
  );
  expect(result.stored).toBe(true);
  await waitForRuntimeReady(page);
  const state = await page.evaluate(async (seed) => {
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
    const stderr: string[] = [];
    const off = sandbox.runtime.on((event) => {
      if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
      if (event.type === 'stderr' && event.chunk) stderr.push(event.chunk);
    });
    await sandbox.fs.writeFile('/preservation/value.txt', seed);
    await sandbox.fs.writeFile('/preservation/child.cjs', "console.log('generic-child');\n");
    const text = await sandbox.fs.readFile('/preservation/value.txt', 'utf8');
    const evaluated = await sandbox.runtime.eval(
      `(async () => {
        console.log('generic-no-coi:' + require('node:fs').readFileSync('/preservation/value.txt', 'utf8'));
        const os = require('node:os');
        const cp = require('node:child_process');
        await new Promise((resolve, reject) => {
          const child = cp.spawn('node', ['/preservation/child.cjs']);
          child.once('error', reject);
          child.once('close', resolve);
        });
        console.log('__RIFTY_GENERIC_CPU__' + JSON.stringify({
          cpus: os.cpus().length,
          parallelism: os.availableParallelism(),
          hardware: navigator.hardwareConcurrency,
        }));
      })()`,
    );
    off();
    const cpuLine = stdout
      .join('')
      .split('\n')
      .find((line) => line.startsWith('__RIFTY_GENERIC_CPU__'));
    if (cpuLine === undefined) throw new Error('generic CPU marker missing');
    return {
      defaultError: holder.__riftyNoCoiDefaultError,
      text,
      evalOk: evaluated.ok,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      hasToolchain: 'toolchain' in sandbox,
      hasCapabilityReport: 'capabilityReport' in sandbox,
      cpu: JSON.parse(cpuLine.slice('__RIFTY_GENERIC_CPU__'.length)),
    };
  }, 'public-worker');
  return { ...state, expectedCoiMessage: result.expectedCoiMessage };
}

async function createToolchainSandbox(page: Page): Promise<{
  readonly hasToolchain: boolean;
  readonly installType: string;
  readonly runBinType: string;
  readonly report: unknown;
  readonly reportFrozen: boolean;
  readonly reportDeepFrozen: boolean;
  readonly falseFlagErrors: readonly {
    readonly name: string;
    readonly message: string;
    readonly canonicalTypeError: boolean;
  }[];
}> {
  const state = await page.evaluate(
    async ({ sdkUrl, selectedToolchainWorkerUrl }) => {
      const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
        createSandbox(options: Record<string, unknown>): Promise<unknown>;
      };
      const falseFlagErrors: Array<{
        name: string;
        message: string;
        canonicalTypeError: boolean;
      }> = [];
      for (const requireCrossOriginIsolation of [undefined, true]) {
        try {
          await sdk.createSandbox({
            ...(requireCrossOriginIsolation === undefined ? {} : { requireCrossOriginIsolation }),
            skipServiceWorker: true,
            toolchain: { workerUrl: selectedToolchainWorkerUrl },
          });
          throw new Error('toolchain false-flag admission unexpectedly booted');
        } catch (error) {
          const inspected = error instanceof Error ? error : new Error(String(error));
          falseFlagErrors.push({
            name: inspected.name,
            message: inspected.message,
            canonicalTypeError: error instanceof TypeError,
          });
        }
      }
      const sandbox = (await sdk.createSandbox({
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
        falseFlagErrors,
      };
    },
    {
      sdkUrl: sdkModuleUrl,
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
  expect(moduleTransformLines(build.out)).toEqual(['✓ 2180 modules transformed.']);
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
          fs: {
            readFile(path: string): Promise<Uint8Array>;
            readFile(path: string, encoding: 'utf8'): Promise<string>;
          };
        };
      }
    ).__riftyNoCoiSandbox;
    const lock = JSON.parse(await sandbox.fs.readFile('/project/package-lock.json', 'utf8'));
    const trace = lock.rifty?.shadowSubstitutions;
    const recipe = trace?.applied?.find(
      (candidate: Record<string, unknown>) =>
        (candidate.materialization as { name?: unknown } | undefined)?.name === 'esbuild',
    );
    const wasm = await sandbox.fs.readFile('/project/node_modules/esbuild-wasm/esbuild.wasm');
    const wasmSha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', wasm)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    return {
      protocol: trace?.protocol,
      substitutionId: recipe?.substitutionId,
      catalog: recipe?.catalog,
      recipeDigest: recipe?.recipeDigest,
      acquisition: recipe?.acquisition,
      binding: recipe?.binding,
      materialization: recipe?.materialization,
      lockEntry: lock.packages?.['node_modules/esbuild'],
      twinLockEntry: lock.packages?.['node_modules/esbuild-wasm'],
      twinMember: { bytes: wasm.byteLength, sha256: wasmSha256 },
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
    expect(result.defaultError.message).toBe(result.expectedCoiMessage);
    expect(result.text).toBe('public-worker');
    expect(result.evalOk).toBe(true);
    expect(result.stdout).toContain('generic-no-coi:public-worker');
    expect(result.hasToolchain).toBe(false);
    expect(result.hasCapabilityReport).toBe(false);
    expect(result.cpu).toMatchObject({
      cpus: result.cpu.hardware,
      parallelism: result.cpu.hardware,
    });
    expect(result.stderr).not.toMatch(/\[rifty:child_process\].*same-realm/u);
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

test('public SDK admits no-COI only through literal false — designed RED', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const outcomes = await host.evaluate(
      async ({ sdkUrl, genericWorkerUrl, selectedToolchainWorkerUrl }) => {
        const NativeWorker = globalThis.Worker;
        const workers: string[] = [];
        let activeTrace: string[] | undefined;
        class ObservedWorker extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            activeTrace?.push('toolchain-worker');
            workers.push(String(url));
          }
        }
        Object.defineProperty(globalThis, 'Worker', {
          configurable: true,
          value: ObservedWorker,
          writable: true,
        });
        try {
          const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
            COI_REQUIRED_MESSAGE: string;
            createSandbox(
              options: Record<string, unknown>,
              deps?: Record<string, unknown>,
            ): Promise<{ dispose(): void }>;
          };
          const fakeRuntime = {
            eval: () => Promise.resolve({ id: 0, ok: true, value: undefined }),
            fs: {
              readFile: () => Promise.resolve(new Uint8Array()),
              writeFile: () => Promise.resolve(),
            },
            reset: () => Promise.resolve(),
            dispose: () => {},
            on: () => () => {},
            writeFile: () => {},
            writeStdin: () => {},
            isReady: () => true,
          };
          const depsForTrace = (trace: string[]) => ({
            detect: () => {
              trace.push('detect');
              return {
                capabilities: {
                  crossOriginIsolated: false,
                  sharedArrayBuffer: false,
                  atomicsWaitAsync: false,
                  opfsSyncAccessHandle: true,
                  serviceWorker: true,
                  worker: true,
                },
                missing: ['crossOriginIsolated'],
                sufficient: true,
                summary: 'browser admission vector',
              };
            },
            initVfs: () => {
              trace.push('vfs');
              return Promise.resolve('opfs');
            },
            registerSw: () => {
              trace.push('sw');
              return Promise.resolve();
            },
            spawn: () => {
              trace.push('generic-worker');
              return fakeRuntime;
            },
          });
          const genericRequired: Array<Record<string, unknown>> = [];
          for (const { label, options } of [
            { label: 'omitted', options: { workerUrl: genericWorkerUrl } },
            {
              label: 'true',
              options: { workerUrl: genericWorkerUrl, requireCrossOriginIsolation: true },
            },
          ]) {
            const trace: string[] = [];
            activeTrace = trace;
            const before = workers.length;
            let error: unknown;
            try {
              const sandbox = await sdk.createSandbox(options, depsForTrace(trace));
              sandbox.dispose();
            } catch (caught) {
              error = caught;
            }
            genericRequired.push({
              value: label,
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : { name: typeof error, message: String(error) },
              workerConstructions: workers.length - before,
              effects: trace,
            });
            activeTrace = undefined;
          }
          const values = [
            { label: 'explicit-undefined', value: undefined },
            { label: 'zero', value: 0 },
            { label: 'empty-string', value: '' },
            { label: 'NaN', value: Number.NaN },
            { label: 'null', value: null },
            { label: 'one', value: 1 },
            { label: 'string-false', value: 'false' },
            { label: 'bigint-zero', value: 0n },
            { label: 'bigint-one', value: 1n },
            { label: 'symbol', value: Symbol('isolation') },
            { label: 'function', value: () => false },
            { label: 'object', value: {} },
            { label: 'array', value: [] },
          ];
          const results: Array<Record<string, unknown>> = [];
          for (const mode of ['generic', 'toolchain']) {
            for (const { label, value } of values) {
              const trace: string[] = [];
              activeTrace = trace;
              const before = workers.length;
              let error: unknown;
              try {
                const sandbox = await sdk.createSandbox(
                  mode === 'generic'
                    ? {
                        workerUrl: genericWorkerUrl,
                        requireCrossOriginIsolation: value,
                      }
                    : {
                        requireCrossOriginIsolation: value,
                        toolchain: { workerUrl: selectedToolchainWorkerUrl },
                      },
                  depsForTrace(trace),
                );
                sandbox.dispose();
              } catch (caught) {
                error = caught;
              }
              results.push({
                mode,
                value: label,
                error:
                  error instanceof Error
                    ? {
                        name: error.name,
                        message: error.message,
                        canonicalTypeError: error instanceof TypeError,
                      }
                    : {
                        name: typeof error,
                        message: String(error),
                        canonicalTypeError: false,
                      },
                workerConstructions: workers.length - before,
                effects: trace,
              });
              activeTrace = undefined;
            }
          }
          return {
            crossOriginIsolated,
            genericRequired,
            requiredMessage: sdk.COI_REQUIRED_MESSAGE,
            results,
          };
        } finally {
          Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: NativeWorker,
            writable: true,
          });
        }
      },
      {
        sdkUrl: sdkModuleUrl,
        genericWorkerUrl: runtimeWorkerUrl,
        selectedToolchainWorkerUrl: toolchainWorkerUrl,
      },
    );

    expect(outcomes.crossOriginIsolated).toBe(false);
    expect(outcomes.genericRequired).toEqual([
      {
        value: 'omitted',
        error: { name: 'Error', message: outcomes.requiredMessage },
        workerConstructions: 0,
        effects: ['detect'],
      },
      {
        value: 'true',
        error: { name: 'Error', message: outcomes.requiredMessage },
        workerConstructions: 0,
        effects: ['detect'],
      },
    ]);
    expect(outcomes.results).toEqual(
      ['generic', 'toolchain'].flatMap((mode) =>
        [
          'explicit-undefined',
          'zero',
          'empty-string',
          'NaN',
          'null',
          'one',
          'string-false',
          'bigint-zero',
          'bigint-one',
          'symbol',
          'function',
          'object',
          'array',
        ].map((value) => ({
          mode,
          value,
          error: {
            name: 'TypeError',
            message: expect.stringMatching(/boolean.*false/u),
            canonicalTypeError: true,
          },
          workerConstructions: 0,
          effects: [],
        })),
      ),
    );
  } finally {
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
    expect(state.falseFlagErrors).toEqual([
      expect.objectContaining({
        name: 'TypeError',
        message: expect.stringContaining('false'),
        canonicalTypeError: true,
      }),
      expect.objectContaining({
        name: 'TypeError',
        message: expect.stringContaining('false'),
        canonicalTypeError: true,
      }),
    ]);
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
          const globalMemory = globalThis.WebAssembly.Memory;
          const privateMemory = new WebAssembly.Memory({ initial: 1 });
          const privateWasmBytes = privateMemory.buffer.byteLength;
          console.log('__RIFTY_SURFACES__' + JSON.stringify({
            first, second, thread, cpus: os.cpus().length,
            parallelism: os.availableParallelism(), execSync, sharedWasm, privateWasmBytes,
            privateConstructorIsGlobal: privateMemory.constructor === globalMemory,
            privatePrototypeIsGlobal: Object.getPrototypeOf(privateMemory) === globalMemory.prototype,
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
      privateConstructorIsGlobal: true,
      privatePrototypeIsGlobal: true,
    });
    expect((surfaces.stderr.match(/\[rifty:child_process\].*same-realm/gu) ?? []).length).toBe(1);
    expect((surfaces.stderr.match(/\[rifty:worker_threads\].*same-realm/gu) ?? []).length).toBe(1);
    assertHostSnapshot(await hostSnapshot(host), baseline);
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('public SDK projects one real Worker, VFS and runtime authority', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const authority = await host.evaluate(
      async ({ sdkUrl, vfsUrl, selectedToolchainWorkerUrl }) => {
        const NativeWorker = globalThis.Worker;
        const workers: Array<{ url: string; type: string | null }> = [];
        class ObservedWorker extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            workers.push({ url: String(url), type: options?.type ?? null });
          }
        }
        Object.defineProperty(globalThis, 'Worker', {
          configurable: true,
          value: ObservedWorker,
          writable: true,
        });
        try {
          const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
            createSandbox(options: Record<string, unknown>): Promise<{
              runtime: { readonly fs: unknown; readonly toolchain?: unknown; isReady(): boolean };
              fs: unknown;
              toolchain: unknown;
              vfs: { readonly backend: 'opfs' | 'memory' };
              dispose(): void;
            }>;
          };
          const vfs = (await import(/* @vite-ignore */ vfsUrl)) as {
            detectVfsBackend(): 'opfs' | 'memory';
          };
          const pageBackend = vfs.detectVfsBackend();
          const sandbox = await sdk.createSandbox({
            requireCrossOriginIsolation: false,
            skipServiceWorker: true,
            toolchain: { workerUrl: selectedToolchainWorkerUrl },
          });
          try {
            return {
              crossOriginIsolated,
              pageBackend,
              publicBackend: sandbox.vfs.backend,
              workerCount: workers.length,
              workers,
              runtimeReady: sandbox.runtime.isReady(),
              fsIdentity: sandbox.fs === sandbox.runtime.fs,
              toolchainIdentity: sandbox.toolchain === sandbox.runtime.toolchain,
            };
          } finally {
            sandbox.dispose();
          }
        } finally {
          Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: NativeWorker,
            writable: true,
          });
        }
      },
      {
        sdkUrl: sdkModuleUrl,
        vfsUrl: sdkVfsModuleUrl,
        selectedToolchainWorkerUrl: toolchainWorkerUrl,
      },
    );

    expect(authority).toEqual({
      crossOriginIsolated: false,
      pageBackend: 'memory',
      publicBackend: 'opfs',
      workerCount: 1,
      workers: [{ url: toolchainWorkerUrl, type: 'module' }],
      runtimeReady: true,
      fsIdentity: true,
      toolchainIdentity: true,
    });
  } finally {
    await host.close();
  }
});

test('Chrome Worker clone materializes an accessor protocol as exact data', async ({ page }) => {
  await page.goto('/no-coi-harness.html');
  const cloned = await page.evaluate(async () => {
    const source = `
      const frame = { type: 'toolchain-ready', vfsBackend: 'memory' };
      Object.defineProperty(frame, 'protocol', {
        enumerable: true,
        get: () => 'rifty.sandbox-toolchain/v2',
      });
      postMessage(frame);
    `;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = new Worker(url, { type: 'module' });
        worker.addEventListener('error', (event) => reject(new Error(event.message)), {
          once: true,
        });
        worker.addEventListener(
          'message',
          (event: MessageEvent<Record<string, unknown>>) => {
            const descriptors = Object.getOwnPropertyDescriptors(event.data);
            const protocol = descriptors.protocol;
            worker.terminate();
            resolve({
              plain: Object.getPrototypeOf(event.data) === Object.prototype,
              keys: Object.keys(descriptors).toSorted(),
              protocolKind: protocol && 'value' in protocol ? 'data' : 'accessor',
              protocolValue: protocol && 'value' in protocol ? protocol.value : undefined,
            });
          },
          { once: true },
        );
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  expect(cloned).toEqual({
    plain: true,
    keys: ['protocol', 'type', 'vfsBackend'],
    protocolKind: 'data',
    protocolValue: 'rifty.sandbox-toolchain/v2',
  });
});

test('public SDK rejects an invalid real Worker before queued later frames can admit', async ({
  page,
}) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const outcome = await host.evaluate(
      async ({ sdkUrl, ioUrl }) => {
        const source = `
        postMessage({ type: 'ready' });
        postMessage({
          type: 'toolchain-ready',
          protocol: 'rifty.sandbox-toolchain/v10',
          vfsBackend: 'memory',
        });
        postMessage({
          type: 'toolchain-ready',
          protocol: 'rifty.sandbox-toolchain/v2',
          vfsBackend: 'memory',
        });
        postMessage({ type: 'ready' });
        postMessage({ type: 'result', result: { id: 1, ok: true, value: 42 } });
      `;
        const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const NativeWorker = globalThis.Worker;
        const received: string[] = [];
        let constructions = 0;
        let terminations = 0;
        class ObservedWorker extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            constructions += 1;
            this.addEventListener('message', (event: MessageEvent<{ type?: unknown }>) => {
              received.push(String(event.data?.type));
            });
            const nativeTerminate = this.terminate.bind(this);
            Object.defineProperty(this, 'terminate', {
              value() {
                terminations += 1;
                nativeTerminate();
              },
            });
          }
        }
        Object.defineProperty(globalThis, 'Worker', {
          configurable: true,
          value: ObservedWorker,
          writable: true,
        });
        try {
          const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
            createSandbox(options: Record<string, unknown>): Promise<unknown>;
          };
          const io = (await import(/* @vite-ignore */ ioUrl)) as {
            NotImplementedError: typeof Error;
          };
          let result: Record<string, unknown>;
          try {
            await sdk.createSandbox({
              requireCrossOriginIsolation: false,
              skipServiceWorker: true,
              toolchain: { workerUrl },
            });
            result = { status: 'resolved' };
          } catch (error) {
            const inspected = error as Error & { feature?: string };
            result = {
              status: 'rejected',
              name: inspected.name,
              feature: inspected.feature,
              canonical: error instanceof io.NotImplementedError,
            };
          }
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return { ...result, constructions, terminations, received };
        } finally {
          Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: NativeWorker,
            writable: true,
          });
          URL.revokeObjectURL(workerUrl);
        }
      },
      { sdkUrl: sdkModuleUrl, ioUrl: sdkIoModuleUrl },
    );

    expect(outcome).toEqual({
      status: 'rejected',
      name: 'NotImplementedError',
      feature: 'sandbox.toolchain.worker',
      canonical: true,
      constructions: 1,
      terminations: 1,
      received: ['ready', 'toolchain-ready'],
    });
  } finally {
    await host.close();
  }
});

test('public SDK backend mismatch throws the canonical NotImplementedError', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const outcome = await host.evaluate(
      async ({ sdkUrl, ioUrl }) => {
        const source = `
          postMessage({ type: 'ready' });
          postMessage({
            type: 'toolchain-ready',
            protocol: 'rifty.sandbox-toolchain/v2',
            vfsBackend: 'indexeddb',
          });
        `;
        const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        try {
          const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
            createSandbox(options: Record<string, unknown>): Promise<unknown>;
          };
          const io = (await import(/* @vite-ignore */ ioUrl)) as {
            NotImplementedError: typeof Error;
          };
          try {
            await sdk.createSandbox({
              requireCrossOriginIsolation: false,
              skipServiceWorker: true,
              toolchain: { workerUrl },
            });
            return { status: 'resolved' };
          } catch (error) {
            const inspected = error as Error & { feature?: string };
            return {
              status: 'rejected',
              name: inspected.name,
              feature: inspected.feature,
              canonical: error instanceof io.NotImplementedError,
            };
          }
        } finally {
          URL.revokeObjectURL(workerUrl);
        }
      },
      { sdkUrl: sdkModuleUrl, ioUrl: sdkIoModuleUrl },
    );

    expect(outcome).toEqual({
      status: 'rejected',
      name: 'NotImplementedError',
      feature: 'sandbox.toolchain.worker',
      canonical: true,
    });
  } finally {
    await host.close();
  }
});

test('public SDK waits for both readiness signals in either real Worker order', async ({
  page,
}) => {
  const { host } = await openHeaderlessHost(page);
  try {
    const outcomes = await host.evaluate(
      async ({ sdkUrl }) => {
        const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
          createSandbox(options: Record<string, unknown>): Promise<{
            runtime: { isReady(): boolean };
            vfs: { backend: 'opfs' | 'memory' };
            dispose(): void;
          }>;
        };
        const NativeWorker = globalThis.Worker;
        const run = async (kind: 'exact' | 'mismatch', backend: 'opfs' | 'memory') => {
          const protocol =
            kind === 'exact' ? 'rifty.sandbox-toolchain/v2' : 'rifty.sandbox-toolchain/v10';
          const source = `
          addEventListener('message', (event) => {
            if (event.data === 'release-runtime-ready') postMessage({ type: 'ready' });
          });
          postMessage({
            type: 'toolchain-ready',
            protocol: ${JSON.stringify(protocol)},
            vfsBackend: ${JSON.stringify(backend)},
          });
        `;
          const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          let selectedWorker: Worker | undefined;
          let constructions = 0;
          let terminations = 0;
          let resolveFirstSignal: () => void = () => {};
          const firstSignal = new Promise<void>((resolve) => {
            resolveFirstSignal = resolve;
          });
          class ObservedWorker extends NativeWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
              super(url, options);
              constructions += 1;
              selectedWorker = this;
              this.addEventListener(
                'message',
                (event: MessageEvent<{ type?: unknown }>) => {
                  if (event.data?.type === 'toolchain-ready') resolveFirstSignal();
                },
                { once: true },
              );
              const nativeTerminate = this.terminate.bind(this);
              Object.defineProperty(this, 'terminate', {
                value() {
                  terminations += 1;
                  nativeTerminate();
                },
              });
            }
          }
          Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: ObservedWorker,
            writable: true,
          });
          let settled = 'pending';
          try {
            const creating = sdk
              .createSandbox({
                requireCrossOriginIsolation: false,
                skipServiceWorker: true,
                toolchain: { workerUrl },
              })
              .then(
                (sandbox) => {
                  settled = 'resolved';
                  return { status: 'resolved' as const, sandbox };
                },
                (error: Error & { feature?: string }) => {
                  settled = 'rejected';
                  return {
                    status: 'rejected' as const,
                    name: error.name,
                    feature: error.feature,
                  };
                },
              );
            await firstSignal;
            await Promise.resolve();
            const afterToolchainReady = settled;
            selectedWorker?.postMessage('release-runtime-ready');
            const result = await creating;
            if (result.status === 'rejected') {
              return {
                kind,
                backend,
                afterToolchainReady,
                status: result.status,
                name: result.name,
                feature: result.feature,
                constructions,
                terminations,
              };
            }
            const admitted = {
              kind,
              backend,
              afterToolchainReady,
              status: result.status,
              publicBackend: result.sandbox.vfs.backend,
              runtimeReady: result.sandbox.runtime.isReady(),
              constructions,
              terminationsBeforeDispose: terminations,
            };
            result.sandbox.dispose();
            return admitted;
          } finally {
            Object.defineProperty(globalThis, 'Worker', {
              configurable: true,
              value: NativeWorker,
              writable: true,
            });
            URL.revokeObjectURL(workerUrl);
          }
        };

        const results: unknown[] = [];
        for (const backend of ['opfs', 'memory'] as const) {
          results.push(await run('exact', backend));
          results.push(await run('mismatch', backend));
        }
        return results;
      },
      { sdkUrl: sdkModuleUrl },
    );

    expect(outcomes).toEqual([
      {
        kind: 'exact',
        backend: 'opfs',
        afterToolchainReady: 'pending',
        status: 'resolved',
        publicBackend: 'opfs',
        runtimeReady: true,
        constructions: 1,
        terminationsBeforeDispose: 0,
      },
      {
        kind: 'mismatch',
        backend: 'opfs',
        afterToolchainReady: 'pending',
        status: 'rejected',
        name: 'NotImplementedError',
        feature: 'sandbox.toolchain.worker',
        constructions: 1,
        terminations: 1,
      },
      {
        kind: 'exact',
        backend: 'memory',
        afterToolchainReady: 'pending',
        status: 'resolved',
        publicBackend: 'memory',
        runtimeReady: true,
        constructions: 1,
        terminationsBeforeDispose: 0,
      },
      {
        kind: 'mismatch',
        backend: 'memory',
        afterToolchainReady: 'pending',
        status: 'rejected',
        name: 'NotImplementedError',
        feature: 'sandbox.toolchain.worker',
        constructions: 1,
        terminations: 1,
      },
    ]);
  } finally {
    await host.close();
  }
});

test('non-shared WebAssembly.Memory keeps native constructor/global identity', async ({ page }) => {
  await page.goto('/no-coi-harness.html');
  const identity = await page.evaluate(
    ({ fixtureUrl, selectedToolchainWorkerUrl }) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = new Worker(fixtureUrl, { type: 'module' });
        const timer = setTimeout(() => reject(new Error('memory identity timeout')), 30_000);
        worker.addEventListener('error', (event) => {
          clearTimeout(timer);
          reject(new Error(event.message));
        });
        worker.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
          if (event.data.type !== 'memory-identity') return;
          clearTimeout(timer);
          worker.terminate();
          resolve(event.data);
        });
        worker.postMessage({ toolchainWorkerUrl: selectedToolchainWorkerUrl });
      }),
    { fixtureUrl: memoryIdentityWorkerUrl, selectedToolchainWorkerUrl: toolchainWorkerUrl },
  );
  expect(identity).toEqual({
    type: 'memory-identity',
    globalConstructorUnchanged: true,
    instanceConstructorUnchanged: true,
    prototypeUnchanged: true,
    bytes: 65_536,
  });
});

test('request-identical Vite 7/8 decoys follow installed bytes, never identity', async ({
  page,
}) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    for (const fixture of [
      { version: '7.3.6', root: '/project', marker: 'vite7-decoy' },
      { version: '8.0.16', root: '/vite8', marker: 'vite8-decoy' },
    ]) {
      const outcome = await host.evaluate(
        async ({ fixture }) => {
          const sandbox = (
            globalThis as typeof globalThis & {
              __riftyNoCoiSandbox: {
                fs: {
                  writeFile(path: string, value: string): Promise<void>;
                  readFile(path: string, encoding: 'utf8'): Promise<string>;
                };
                runtime: { on(fn: (event: { type: string; chunk?: string }) => void): () => void };
                toolchain: {
                  runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
                };
              };
            }
          ).__riftyNoCoiSandbox;
          await sandbox.fs.writeFile(
            `${fixture.root}/node_modules/vite/package.json`,
            JSON.stringify({
              name: 'vite',
              version: fixture.version,
              type: 'module',
              bin: { vite: 'bin/vite.js' },
            }),
          );
          await sandbox.fs.writeFile(
            `${fixture.root}/node_modules/vite/bin/vite.js`,
            `console.log(${JSON.stringify('__RIFTY_GENERIC_BIN__')} + ${JSON.stringify(fixture.marker)})\n`,
          );
          await sandbox.fs.writeFile(
            `${fixture.root}/node_modules/.bin/vite`,
            "#!/usr/bin/env node\nimport('../vite/bin/vite.js');\n",
          );
          const manifest = JSON.parse(
            await sandbox.fs.readFile(`${fixture.root}/node_modules/vite/package.json`, 'utf8'),
          );
          const output: string[] = [];
          const off = sandbox.runtime.on((event) => {
            if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk) {
              output.push(event.chunk);
            }
          });
          try {
            const request = {
              cwd: fixture.root,
              binPath: `${fixture.root}/node_modules/.bin/vite`,
              args: ['build'],
            };
            const result = await sandbox.toolchain.runBin(request);
            return { request, result, manifest, output: output.join('') };
          } finally {
            off();
          }
        },
        { fixture },
      );
      expect(outcome).toEqual({
        request: {
          cwd: fixture.root,
          binPath: `${fixture.root}/node_modules/.bin/vite`,
          args: ['build'],
        },
        result: { exitCode: 0 },
        manifest: {
          name: 'vite',
          version: fixture.version,
          type: 'module',
          bin: { vite: 'bin/vite.js' },
        },
        output: `__RIFTY_GENERIC_BIN__${fixture.marker}\n`,
      });
    }
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('exact nanoid manifest runs its installed bin without Vite authority', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    const outcome = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            fs: {
              writeFile(path: string, value: string): Promise<void>;
              readFile(path: string, encoding: 'utf8'): Promise<string>;
            };
            runtime: { on(fn: (event: { type: string; chunk?: string }) => void): () => void };
            toolchain: {
              install(input: Record<string, unknown>): Promise<void>;
              runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
            };
          };
        }
      ).__riftyNoCoiSandbox;
      const root = '/generic-nanoid';
      await sandbox.fs.writeFile(
        `${root}/package.json`,
        JSON.stringify({
          name: 'generic-nanoid',
          private: true,
          dependencies: { nanoid: '3.3.18' },
        }),
      );
      await sandbox.toolchain.install({ cwd: root, registryUrl: '/npm-registry' });
      const manifest = JSON.parse(
        await sandbox.fs.readFile(`${root}/node_modules/nanoid/package.json`, 'utf8'),
      );
      const launcher = await sandbox.fs.readFile(`${root}/node_modules/.bin/nanoid`, 'utf8');
      const output: string[] = [];
      const off = sandbox.runtime.on((event) => {
        if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk) {
          output.push(event.chunk);
        }
      });
      try {
        const result = await sandbox.toolchain.runBin({
          cwd: root,
          binPath: `${root}/node_modules/.bin/nanoid`,
          args: ['--size', '7'],
        });
        return { result, output: output.join(''), manifest, launcher };
      } finally {
        off();
      }
    });
    expect(outcome.result).toEqual({ exitCode: 0 });
    expect(outcome.output.trim()).toMatch(/^[A-Za-z0-9_-]{7}$/u);
    expect(outcome.manifest).toMatchObject({
      name: 'nanoid',
      version: '3.3.18',
      bin: './bin/nanoid.cjs',
    });
    expect(outcome.launcher).toContain('../nanoid/bin/nanoid.cjs');
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('threaded-WASM guard covers real installed bin, CJS, ESM and REPL descriptors', async ({
  page,
}) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    const outcomes = await host.evaluate(
      async ({ probeExpression }) => {
        const sandbox = (
          globalThis as typeof globalThis & {
            __riftyNoCoiSandbox: {
              fs: { writeFile(path: string, value: string): Promise<void> };
              runtime: {
                eval(source: string): Promise<{ ok: boolean }>;
                on(fn: (event: { type: string; chunk?: string }) => void): () => void;
              };
              toolchain: {
                runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
              };
            };
          }
        ).__riftyNoCoiSandbox;
        const root = '/threaded-wasm-twins';
        const markers = {
          repl: '__RIFTY_WASM_REPL__',
          cjs: '__RIFTY_WASM_CJS__',
          esm: '__RIFTY_WASM_ESM__',
          bin: '__RIFTY_WASM_BIN__',
        } as const;
        await sandbox.fs.writeFile(`${root}/cjs.cjs`, `module.exports = ${probeExpression};\n`);
        await sandbox.fs.writeFile(
          `${root}/esm.mjs`,
          `export const outcome = ${probeExpression};\n`,
        );
        await sandbox.fs.writeFile(
          `${root}/node_modules/.bin/memory-probe`,
          "#!/usr/bin/env node\nimport('../memory-probe/cli.js');\n",
        );
        await sandbox.fs.writeFile(
          `${root}/node_modules/memory-probe/package.json`,
          JSON.stringify({ name: 'memory-probe', type: 'commonjs' }),
        );
        await sandbox.fs.writeFile(
          `${root}/node_modules/memory-probe/cli.js`,
          `console.log(${JSON.stringify(markers.bin)} + JSON.stringify(${probeExpression}));\n`,
        );
        const stdout: string[] = [];
        const off = sandbox.runtime.on((event) => {
          if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
        });
        const repl = await sandbox.runtime.eval(
          `console.log(${JSON.stringify(markers.repl)} + JSON.stringify(${probeExpression}))`,
        );
        const cjs = await sandbox.runtime.eval(
          `console.log(${JSON.stringify(markers.cjs)} + JSON.stringify(require(${JSON.stringify(`${root}/cjs.cjs`)})))`,
        );
        const esm = await sandbox.runtime.eval(
          `__riftyImport(${JSON.stringify(`${root}/esm.mjs`)}).then(({ outcome }) => console.log(${JSON.stringify(markers.esm)} + JSON.stringify(outcome)))`,
        );
        const bin = await sandbox.toolchain.runBin({
          cwd: root,
          binPath: `${root}/node_modules/.bin/memory-probe`,
          args: [],
        });
        off();
        const text = stdout.join('');
        const read = (selected: string) => {
          const line = text.split('\n').find((entry) => entry.startsWith(selected));
          if (line === undefined) throw new Error(`missing threaded-WASM marker ${selected}`);
          return JSON.parse(line.slice(selected.length));
        };
        return {
          evalOk: { repl: repl.ok, cjs: cjs.ok, esm: esm.ok },
          bin,
          repl: read(markers.repl),
          cjs: read(markers.cjs),
          esm: read(markers.esm),
          installedBin: read(markers.bin),
        };
      },
      { probeExpression: threadedWasmProbeExpression },
    );
    const expected = {
      shared: [
        'own-literal-true',
        'inherited-literal-true',
        'accessor-literal-true',
        'own-truthy-number',
        'own-truthy-string',
        'callable-literal-true',
      ].map((form) => ({
        form,
        name: 'NotImplementedError',
        feature: 'toolchain.threaded-wasm',
      })),
      identity: {
        globalConstructorUnchanged: true,
        instanceConstructorUnchanged: true,
        prototypeUnchanged: true,
        bytes: 65_536,
      },
    };
    expect(outcomes.evalOk).toEqual({ repl: true, cjs: true, esm: true });
    expect(outcomes.bin).toEqual({ exitCode: 0 });
    expect({
      repl: outcomes.repl,
      cjs: outcomes.cjs,
      esm: outcomes.esm,
      installedBin: outcomes.installedBin,
    }).toEqual({ repl: expected, cjs: expected, esm: expected, installedBin: expected });
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('package-generic bounded cause projection preserves the honest serialized error', async ({
  browser,
  page,
}) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    const outcomes = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            fs: { writeFile(path: string, value: string): Promise<void> };
            toolchain: { runBin(input: Record<string, unknown>): Promise<unknown> };
          };
        }
      ).__riftyNoCoiSandbox;
      const root = '/generic-cause-projection';
      const binPath = `${root}/node_modules/.bin/cause-probe`;
      await sandbox.fs.writeFile(
        `${root}/node_modules/cause-probe/package.json`,
        JSON.stringify({ name: 'cause-probe', type: 'module' }),
      );
      await sandbox.fs.writeFile(
        `${root}/node_modules/cause-probe/cli.js`,
        `
const wrap = (error, count) => {
  let current = error;
  for (let index = 0; index < count; index += 1) {
    current = new Error('package wrapper ' + index, { cause: current });
  }
  return current;
};
const makeGap = (feature, hint) => {
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  } catch (error) {
    return new error.constructor(feature, hint);
  }
  throw new Error('shared-memory gap constructor did not throw');
};
const decorateOuter = (error, label) => {
  error.name = 'PackageLoaderError';
  error.code = 'ERR_' + label.toUpperCase().replaceAll('-', '_');
  error.path = '/generic-cause-projection/node_modules/cause-probe/' + label + '.js';
  error.feature = 'package.' + label;
  error.message = 'ordinary ' + label + ' outer';
  return error;
};
const mode = process.argv[2];
if (mode.startsWith('gap-depth-')) {
  throw wrap(makeGap('package.feature'), Number(mode.slice('gap-depth-'.length)));
}
if (mode === 'two-gaps') {
  const inner = makeGap('package.inner');
  const outer = makeGap('package.outer');
  outer.cause = inner;
  throw wrap(outer, 3);
}
if (mode === 'custom-gap') {
  const gap = makeGap('package.custom', 'package-defined hint');
  gap.message = 'package-defined custom gap message';
  throw wrap(gap, 4);
}
if (mode === 'own-cause-gap') {
  let causeReads = 0;
  const gap = makeGap('package.own-cause', 'identity wins');
  Object.defineProperty(gap, 'cause', {
    get() {
      causeReads += 1;
      throw new Error('real gap cause getter read');
    },
  });
  Object.defineProperty(gap, 'message', {
    get() {
      return 'package own-cause identity; cause reads ' + causeReads;
    },
  });
  throw wrap(gap, 3);
}
const impostor = Object.assign(new Error('Not implemented: package.feature'), {
  name: 'NotImplementedError',
  feature: 'package.feature',
});
if (mode === 'impostor-direct') throw impostor;
if (mode === 'impostor-wrapped') {
  throw decorateOuter(new Error('seed', { cause: impostor }), 'impostor-wrapped');
}
if (mode === 'object-tail') {
  throw decorateOuter(
    new Error('seed', { cause: { cause: makeGap('package.hidden') } }),
    'object-tail',
  );
}
const getterCases = {
  'exact-bound': { depth: 8, thrown: new Error('forbidden ninth cause read 1') },
  'getter-error': { depth: 3, thrown: new Error('hostile intermediate getter') },
  'getter-primitive': { depth: 4, thrown: 17 },
  'getter-gap': { depth: 5, thrown: makeGap('getter.feature') },
};
const selected = getterCases[mode];
if (selected === undefined) throw new Error('unknown cause probe mode: ' + mode);
const boundary = new Error(mode + ' boundary');
Object.defineProperty(boundary, 'cause', {
  get() {
    throw selected.thrown;
  },
});
throw decorateOuter(wrap(boundary, selected.depth), mode);
`,
      );
      await sandbox.fs.writeFile(
        binPath,
        "#!/usr/bin/env node\nimport('../cause-probe/cli.js');\n",
      );
      const run = async (mode: string) => {
        try {
          await sandbox.toolchain.runBin({ cwd: root, binPath, args: [mode] });
          return { resolved: true };
        } catch (error) {
          const inspected = error as Error & {
            readonly code?: string;
            readonly path?: string;
            readonly feature?: string;
          };
          return {
            resolved: false,
            name: inspected.name,
            message: inspected.message,
            code: inspected.code,
            path: inspected.path,
            feature: inspected.feature,
          };
        }
      };
      const gapDepths = [];
      for (let depth = 0; depth <= 8; depth += 1) {
        gapDepths.push({ depth, failure: await run(`gap-depth-${depth}`) });
      }
      return {
        gapDepths,
        twoGaps: await run('two-gaps'),
        customGap: await run('custom-gap'),
        ownCauseGap: await run('own-cause-gap'),
        impostorDirect: await run('impostor-direct'),
        impostorWrapped: await run('impostor-wrapped'),
        exactBound: await run('exact-bound'),
        getterError: await run('getter-error'),
        getterPrimitive: await run('getter-primitive'),
        getterGap: await run('getter-gap'),
        objectTail: await run('object-tail'),
      };
    });
    console.log(`[bounded-cause] Chrome/${browser.version()} ${JSON.stringify(outcomes)}`);
    const packageGap = {
      resolved: false,
      name: 'NotImplementedError',
      message: 'Not implemented: package.feature',
      code: undefined,
      path: undefined,
      feature: 'package.feature',
    };
    expect(outcomes).toEqual({
      gapDepths: Array.from({ length: 9 }, (_, depth) => ({ depth, failure: packageGap })),
      twoGaps: {
        resolved: false,
        name: 'NotImplementedError',
        message: 'Not implemented: package.outer',
        code: undefined,
        path: undefined,
        feature: 'package.outer',
      },
      customGap: {
        resolved: false,
        name: 'NotImplementedError',
        message: 'package-defined custom gap message',
        code: undefined,
        path: undefined,
        feature: 'package.custom',
      },
      ownCauseGap: {
        resolved: false,
        name: 'NotImplementedError',
        message: 'package own-cause identity; cause reads 0',
        code: undefined,
        path: undefined,
        feature: 'package.own-cause',
      },
      impostorDirect: {
        resolved: false,
        name: 'NotImplementedError',
        message: 'Not implemented: package.feature',
        code: undefined,
        path: undefined,
        feature: 'package.feature',
      },
      impostorWrapped: {
        resolved: false,
        name: 'PackageLoaderError',
        message: 'ordinary impostor-wrapped outer',
        code: 'ERR_IMPOSTOR_WRAPPED',
        path: '/generic-cause-projection/node_modules/cause-probe/impostor-wrapped.js',
        feature: 'package.impostor-wrapped',
      },
      exactBound: {
        resolved: false,
        name: 'PackageLoaderError',
        message: 'ordinary exact-bound outer',
        code: 'ERR_EXACT_BOUND',
        path: '/generic-cause-projection/node_modules/cause-probe/exact-bound.js',
        feature: 'package.exact-bound',
      },
      getterError: {
        resolved: false,
        name: 'PackageLoaderError',
        message: 'ordinary getter-error outer',
        code: 'ERR_GETTER_ERROR',
        path: '/generic-cause-projection/node_modules/cause-probe/getter-error.js',
        feature: 'package.getter-error',
      },
      getterPrimitive: {
        resolved: false,
        name: 'PackageLoaderError',
        message: 'ordinary getter-primitive outer',
        code: 'ERR_GETTER_PRIMITIVE',
        path: '/generic-cause-projection/node_modules/cause-probe/getter-primitive.js',
        feature: 'package.getter-primitive',
      },
      getterGap: {
        resolved: false,
        name: 'PackageLoaderError',
        message: 'ordinary getter-gap outer',
        code: 'ERR_GETTER_GAP',
        path: '/generic-cause-projection/node_modules/cause-probe/getter-gap.js',
        feature: 'package.getter-gap',
      },
      objectTail: {
        resolved: false,
        name: 'PackageLoaderError',
        message: 'ordinary object-tail outer',
        code: 'ERR_OBJECT_TAIL',
        path: '/generic-cause-projection/node_modules/cause-probe/object-tail.js',
        feature: 'package.object-tail',
      },
    });
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('runBin uses the requested installed-bin path as its only authority', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    const failure = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            toolchain: { runBin(input: Record<string, unknown>): Promise<unknown> };
          };
        }
      ).__riftyNoCoiSandbox;
      try {
        await sandbox.toolchain.runBin({
          cwd: '/custom-bin',
          binPath: '/custom-bin/node_modules/.bin/not-installed',
          args: ['build'],
        });
        return { resolved: true };
      } catch (error) {
        const inspected = error as Error & { code?: string; path?: string };
        return {
          resolved: false,
          name: inspected.name,
          message: inspected.message,
          code: inspected.code,
          path: inspected.path,
        };
      }
    });
    expect(failure).toMatchObject({ resolved: false });
    expect(failure.message).toContain('/custom-bin/node_modules/.bin/not-installed');
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('clean self.close rejects an admitted toolchain request without a hang', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    await seedStalledInstall(host, '/clean-close');
    await beginStalledInstall(host, '/clean-close');
    const outcome = await host.evaluate(async () => {
      const holder = globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          runtime: { eval(source: string): Promise<unknown> };
        };
        __riftyPendingToolchain?: Promise<void>;
      };
      const pending = holder.__riftyPendingToolchain;
      if (pending === undefined) throw new Error('admitted install promise is missing');
      void holder.__riftyNoCoiSandbox.runtime.eval('self.close()').catch(() => {});
      try {
        await Promise.race([
          pending,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('settlement timeout')), 5000),
          ),
        ]);
        return { resolved: true };
      } catch (error) {
        const inspected = error as Error & { code?: string };
        return { resolved: false, name: inspected.name, message: inspected.message };
      }
    });
    expect(outcome).toMatchObject({ resolved: false, name: 'WorkerTerminated' });
    expect(outcome.message).not.toContain('settlement timeout');
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
      expect(moduleTransformLines(noCoi.output)).toEqual(['✓ 2180 modules transformed.']);
      expect(noCoi.dist).toEqual(coi.dist);
      expect(noCoi.esbuildAdmission).toMatchObject({
        protocol: 'rifty.shadow-substitutions/v2',
        substitutionId: 'rifty.shadow-substitution.esbuild.v2',
        catalog: {
          id: 'rifty.shadow-substitutions.builtin.v2',
          digest: 'c9f38a0ea9218c64fdc68bca65eb34817cb51f1c1132c89048ffcb86b510d4b0',
        },
        recipeDigest: '7cd677fe08657829bf151d3d97520984d81f70323cdc948f8fd0a7116e4a4afd',
        acquisition: {
          kind: 'registry',
          name: 'esbuild-wasm',
          version: '0.28.0',
        },
        binding: { adapterId: 'rifty.runtime-adapter.esbuild.v1' },
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
        twinLockEntry: {
          version: '0.28.0',
          resolved: expect.stringMatching(/esbuild-wasm.*\.tgz$/u),
          integrity: expect.stringMatching(/^sha512-/u),
        },
        twinMember: {
          bytes: 13_918_738,
          sha256: '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b',
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
      expect(moduleTransformLines(coi.output)).toEqual(['✓ 2180 modules transformed.']);
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
            runtime: {
              eval(source: string): Promise<{ ok: boolean }>;
              on(fn: (event: { type: string; chunk?: string }) => void): () => void;
            };
            toolchain: {
              install(input: Record<string, unknown>): Promise<void>;
              runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
            };
          };
        }
      ).__riftyNoCoiSandbox;
      const root = '/vite8';
      const selectedWasi = await sandbox.runtime.eval("process.env.NAPI_RS_FORCE_WASI = 'error'");
      if (!selectedWasi.ok) throw new Error('Vite 8 boundary fixture could not select WASI');
      await sandbox.fs.writeFile(
        `${root}/package.json`,
        JSON.stringify({
          name: 'vite8-boundary',
          private: true,
          type: 'module',
          dependencies: {
            vite: '8.0.16',
            '@rolldown/binding-wasm32-wasi': '1.0.3',
          },
        }),
      );
      await sandbox.fs.writeFile(
        `${root}/index.html`,
        '<script type="module" src="/src.js"></script>',
      );
      await sandbox.fs.writeFile(`${root}/src.js`, "document.body.textContent='vite8';\n");
      await sandbox.toolchain.install({ cwd: root, registryUrl: '/npm-registry' });
      const manifest = JSON.parse(
        await sandbox.fs.readFile(`${root}/node_modules/vite/package.json`, 'utf8'),
      );
      const launcher = await sandbox.fs.readFile(`${root}/node_modules/.bin/vite`, 'utf8');
      const provenance = { manifest, launcher };
      const replaceOnce = (source: string, needle: string, replacement: string): string => {
        if (source.split(needle).length !== 2) {
          throw new Error(`Vite 8 boundary fixture anchor drifted: ${needle}`);
        }
        return source.replace(needle, replacement);
      };
      const cliPath = `${root}/node_modules/vite/dist/node/cli.js`;
      let cliSource = await sandbox.fs.readFile(cliPath, 'utf8');
      cliSource = replaceOnce(
        cliSource,
        'if (run) this.runMatchedCommand();',
        'if (run) globalThis.__riftyVite8FixtureAction = this.runMatchedCommand();',
      );
      cliSource = replaceOnce(
        cliSource,
        'cli.parse();',
        'cli.parse();\nexport const __promise = globalThis.__riftyVite8FixtureAction;',
      );
      await sandbox.fs.writeFile(cliPath, cliSource);
      const entryPath = `${root}/node_modules/vite/bin/vite.js`;
      let entrySource = await sandbox.fs.readFile(entryPath, 'utf8');
      entrySource = replaceOnce(
        entrySource,
        '} else {\n  start()\n}',
        '} else {\n  globalThis.__riftyVite8FixtureImport = start()\n}\nexport const __promise = globalThis.__riftyVite8FixtureImport.then((namespace) => namespace.__promise)',
      );
      await sandbox.fs.writeFile(entryPath, entrySource);
      const output: string[] = [];
      const off = sandbox.runtime.on((event) => {
        if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk) {
          output.push(event.chunk);
        }
      });
      try {
        const result = await sandbox.toolchain.runBin({
          cwd: root,
          binPath: `${root}/node_modules/.bin/vite`,
          args: ['build'],
        });
        return { threw: false, result, output: output.join(''), provenance };
      } catch (error) {
        const inspected = error as Error & { cause?: unknown; feature?: string };
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
          cause:
            inspected.cause instanceof Error
              ? {
                  name: inspected.cause.name,
                  message: inspected.cause.message,
                  feature: (inspected.cause as Error & { feature?: string }).feature,
                }
              : inspected.cause,
          dist,
          output: output.join(''),
          provenance,
        };
      } finally {
        off();
      }
    });
    if (!failure.threw)
      throw new Error(`Vite 8 boundary did not throw: ${JSON.stringify(failure)}`);
    if (failure.name !== 'NotImplementedError') {
      throw new Error(`Vite 8 boundary threw the wrong error: ${JSON.stringify(failure)}`);
    }
    expect(failure).toMatchObject({
      threw: true,
      name: 'NotImplementedError',
      feature: 'toolchain.threaded-wasm',
      dist: 'absent',
    });
    expect(failure.message).toMatch(/shared WebAssembly\.Memory/i);
    expect(failure.message).toMatch(/SharedArrayBuffer/i);
    expect(failure.message).toMatch(/cross-origin isolation/i);
    expect(failure.provenance.manifest).toMatchObject({
      name: 'vite',
      version: '8.0.16',
      bin: { vite: 'bin/vite.js' },
    });
    expect(failure.provenance.launcher).toContain('../vite/bin/vite.js');
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

async function beginStalledRun(page: Page, root: string): Promise<void> {
  await page.evaluate(async (projectRoot) => {
    const holder = globalThis as typeof globalThis & {
      __riftyNoCoiSandbox: {
        fs: { writeFile(path: string, value: string): Promise<void> };
        runtime: {
          on(fn: (event: { type: string; chunk?: string }) => void): () => void;
        };
        toolchain: { runBin(input: Record<string, unknown>): Promise<unknown> };
      };
      __riftyPendingToolchain?: Promise<unknown>;
    };
    const binPath = `${projectRoot}/node_modules/.bin/stall`;
    await holder.__riftyNoCoiSandbox.fs.writeFile(
      binPath,
      "#!/usr/bin/env node\nimport('../stall-package/cli.js');\n",
    );
    await holder.__riftyNoCoiSandbox.fs.writeFile(
      `${projectRoot}/node_modules/stall-package/package.json`,
      JSON.stringify({ name: 'stall-package', type: 'commonjs' }),
    );
    await holder.__riftyNoCoiSandbox.fs.writeFile(
      `${projectRoot}/node_modules/stall-package/cli.js`,
      "console.log('__RIFTY_STALLED_RUN__'); setInterval(() => {}, 60000); module.exports = {};\n",
    );
    let rejectStarted: (error: Error) => void = () => {};
    const started = new Promise<void>((resolve, reject) => {
      rejectStarted = reject;
      const timer = setTimeout(() => reject(new Error('stalled run start timeout')), 5000);
      const off = holder.__riftyNoCoiSandbox.runtime.on((event) => {
        if (event.type !== 'stdout' || !event.chunk?.includes('__RIFTY_STALLED_RUN__')) return;
        clearTimeout(timer);
        off();
        resolve();
      });
    });
    const operation = holder.__riftyNoCoiSandbox.toolchain.runBin({
      cwd: projectRoot,
      binPath,
      args: [],
    });
    operation.catch((error: unknown) => {
      const inspected = error instanceof Error ? error : new Error(String(error));
      rejectStarted(
        new Error(`stalled run rejected before admission marker: ${inspected.message}`),
      );
    });
    holder.__riftyPendingToolchain = operation;
    await started;
  }, root);
}

async function seedRejectedOperationSentinel(page: Page, root: string): Promise<void> {
  await page.evaluate(async (projectRoot) => {
    const sandbox = (
      globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: { fs: { writeFile(path: string, value: string): Promise<void> } };
      }
    ).__riftyNoCoiSandbox;
    await sandbox.fs.writeFile(
      `${projectRoot}/package.json`,
      JSON.stringify({
        name: 'rejected-operation-sentinel',
        private: true,
        dependencies: { kleur: '4.1.5' },
      }),
    );
    await sandbox.fs.writeFile(
      `${projectRoot}/node_modules/.bin/rejected-operation-sentinel`,
      "#!/usr/bin/env node\nimport('../rejected-operation-sentinel/cli.js');\n",
    );
    await sandbox.fs.writeFile(
      `${projectRoot}/node_modules/rejected-operation-sentinel/package.json`,
      JSON.stringify({ name: 'rejected-operation-sentinel', type: 'commonjs' }),
    );
    await sandbox.fs.writeFile(
      `${projectRoot}/node_modules/rejected-operation-sentinel/cli.js`,
      "require('node:fs').writeFileSync(process.cwd() + '/rejected-dispatch.txt', 'ran'); process.stdout.write('__RIFTY_REJECTED_DISPATCH__');\n",
    );
  }, root);
}

test('host stays interactive while admitted install and run wait at network boundaries', async ({
  page,
}) => {
  const { host, baseline } = await openHeaderlessHost(page);
  const context = host.context();
  const installPattern = '**/npm-registry/kleur*';
  const runPattern = '**/favicon.svg?toolchain-run-boundary=*';
  let resolveInstallRoute: (route: Route) => void = () => {};
  let resolveRunRoute: (route: Route) => void = () => {};
  const installRoute = new Promise<Route>((resolve) => {
    resolveInstallRoute = resolve;
  });
  const runRoute = new Promise<Route>((resolve) => {
    resolveRunRoute = resolve;
  });
  const holdInstall = (route: Route) => resolveInstallRoute(route);
  const holdRun = (route: Route) => resolveRunRoute(route);
  try {
    await assertCrossOriginSubresource(host, baseline, 'before-boot');
    await createToolchainSandbox(host);
    await seedStalledInstall(host, '/interactive-install');
    await context.route(installPattern, holdInstall, { times: 1 });
    await host.evaluate(() => {
      const holder = globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          toolchain: { install(input: Record<string, unknown>): Promise<void> };
        };
        __riftyPendingToolchain?: Promise<unknown>;
      };
      holder.__riftyPendingToolchain = holder.__riftyNoCoiSandbox.toolchain.install({
        cwd: '/interactive-install',
        registryUrl: '/npm-registry',
      });
      holder.__riftyPendingToolchain.catch(() => {});
    });
    const heldInstall = await installRoute;
    const installAdmission = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            toolchain: { install(input: Record<string, unknown>): Promise<void> };
          };
        }
      ).__riftyNoCoiSandbox;
      try {
        await sandbox.toolchain.install({ cwd: '/other', registryUrl: '/npm-registry' });
        return { name: 'resolved' };
      } catch (error) {
        return { name: error instanceof Error ? error.name : String(error) };
      }
    });
    expect(installAdmission).toEqual({ name: 'SandboxToolchainBusyError' });
    await setHostPhase(host, 'during-admitted-install');
    assertHostSnapshot(await hostSnapshot(host), baseline);
    expect(await openerRoundTrip(host)).toBe(true);
    await assertCrossOriginSubresource(host, baseline, 'during-admitted-install');
    await heldInstall.continue();
    await host.evaluate(async () => {
      const pending = (
        globalThis as typeof globalThis & { __riftyPendingToolchain?: Promise<unknown> }
      ).__riftyPendingToolchain;
      if (pending === undefined) throw new Error('admitted install promise is missing');
      await pending;
    });
    await context.unroute(installPattern, holdInstall);

    await context.route(runPattern, holdRun, { times: 1 });
    await host.evaluate(async () => {
      const holder = globalThis as typeof globalThis & {
        __riftyNoCoiSandbox: {
          fs: { writeFile(path: string, value: string): Promise<void> };
          runtime: { on(fn: (event: { type: string; chunk?: string }) => void): () => void };
          toolchain: {
            runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
          };
        };
        __riftyPendingToolchain?: Promise<unknown>;
      };
      const root = '/interactive-run';
      await holder.__riftyNoCoiSandbox.fs.writeFile(
        `${root}/node_modules/.bin/network-boundary`,
        "#!/usr/bin/env node\nimport('../network-boundary/cli.js');\n",
      );
      await holder.__riftyNoCoiSandbox.fs.writeFile(
        `${root}/node_modules/network-boundary/package.json`,
        JSON.stringify({ name: 'network-boundary', type: 'commonjs' }),
      );
      await holder.__riftyNoCoiSandbox.fs.writeFile(
        `${root}/node_modules/network-boundary/cli.js`,
        "fetch('/favicon.svg?toolchain-run-boundary=admitted').then((response) => response.arrayBuffer()).then(() => console.log('__RIFTY_RUN_RELEASED__')); module.exports = {};\n",
      );
      const output: string[] = [];
      const off = holder.__riftyNoCoiSandbox.runtime.on((event) => {
        if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk) {
          output.push(event.chunk);
        }
      });
      holder.__riftyPendingToolchain = holder.__riftyNoCoiSandbox.toolchain
        .runBin({
          cwd: root,
          binPath: `${root}/node_modules/.bin/network-boundary`,
          args: [],
        })
        .then((result) => ({ result, output: output.join('') }))
        .finally(off);
      holder.__riftyPendingToolchain.catch(() => {});
    });
    const heldRun = await runRoute;
    const runAdmission = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            toolchain: { runBin(input: Record<string, unknown>): Promise<unknown> };
          };
        }
      ).__riftyNoCoiSandbox;
      try {
        await sandbox.toolchain.runBin({
          cwd: '/other',
          binPath: '/other/node_modules/.bin/second',
          args: [],
        });
        return { name: 'resolved' };
      } catch (error) {
        return { name: error instanceof Error ? error.name : String(error) };
      }
    });
    expect(runAdmission).toEqual({ name: 'SandboxToolchainBusyError' });
    await setHostPhase(host, 'during-admitted-build');
    assertHostSnapshot(await hostSnapshot(host), baseline);
    expect(await openerRoundTrip(host)).toBe(true);
    await assertCrossOriginSubresource(host, baseline, 'during-admitted-build');
    await heldRun.continue();
    const run = await host.evaluate(async () => {
      const pending = (
        globalThis as typeof globalThis & { __riftyPendingToolchain?: Promise<unknown> }
      ).__riftyPendingToolchain;
      if (pending === undefined) throw new Error('admitted run promise is missing');
      return pending;
    });
    expect(run).toEqual({
      result: { exitCode: 0 },
      output: expect.stringContaining('__RIFTY_RUN_RELEASED__'),
    });
    await context.unroute(runPattern, holdRun);
    await setHostPhase(host, 'after-admitted-operations');
    assertHostSnapshot(await hostSnapshot(host), baseline);
    expect(await openerRoundTrip(host)).toBe(true);
    await assertCrossOriginSubresource(host, baseline, 'after-admitted-operations');
  } finally {
    await context.unroute(installPattern, holdInstall);
    await context.unroute(runPattern, holdRun);
    await disposeSandbox(host);
    await host.close();
  }
});

test('toolchain overlap rejects instead of racing or queuing — designed RED', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    await seedStalledInstall(host, '/malformed');
    const malformed = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            fs: { readFile(path: string, encoding: 'utf8'): Promise<string> };
            runtime: {
              eval(source: string): Promise<{ ok: boolean }>;
              on(fn: (event: { type: string; chunk?: string }) => void): () => void;
            };
            toolchain: {
              install(input: Record<string, unknown>): Promise<void>;
              runBin(input: Record<string, unknown>): Promise<unknown>;
            };
          };
        }
      ).__riftyNoCoiSandbox;
      const processState = async () => {
        const stdout: string[] = [];
        const off = sandbox.runtime.on((event) => {
          if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
        });
        const result = await sandbox.runtime.eval(
          `console.log('__RIFTY_INPUT_STATE__' + JSON.stringify({ cwd: process.cwd(), argv: process.argv }))`,
        );
        off();
        if (!result.ok) throw new Error('process state eval failed');
        const line = stdout
          .join('')
          .split('\n')
          .find((entry) => entry.startsWith('__RIFTY_INPUT_STATE__'));
        if (line === undefined) throw new Error('process state marker missing');
        return JSON.parse(line.slice('__RIFTY_INPUT_STATE__'.length));
      };
      const before = await sandbox.fs.readFile('/malformed/package.json', 'utf8');
      const processBefore = await processState();
      const failures: Array<{ name: string; message: string }> = [];
      const calls = [
        () => sandbox.toolchain.install({ cwd: '/malformed' }),
        () =>
          sandbox.toolchain.install({
            cwd: '/malformed',
            registryUrl: '/npm-registry',
            extra: 'ordinary',
          }),
        () =>
          sandbox.toolchain.runBin({
            cwd: '/malformed',
            binPath: '/malformed/node_modules/.bin/vite',
          }),
        () =>
          sandbox.toolchain.runBin({
            cwd: '/malformed',
            binPath: '/malformed/node_modules/.bin/vite',
            args: ['build'],
            extra: 'ordinary',
          }),
        () => sandbox.toolchain.install({ cwd: 'relative', registryUrl: '/npm-registry' }),
        () =>
          sandbox.toolchain.runBin({
            cwd: '/malformed',
            binPath: '/other/node_modules/.bin/vite',
            args: ['build'],
          }),
        () =>
          sandbox.toolchain.runBin({
            cwd: '/malformed',
            binPath: '/malformed/node_modules/.bin/vite',
            args: 'build',
          }),
      ];
      for (const call of calls) {
        try {
          await call();
        } catch (error) {
          const inspected = error instanceof Error ? error : new Error(String(error));
          failures.push({ name: inspected.name, message: inspected.message });
        }
      }
      const after = await sandbox.fs.readFile('/malformed/package.json', 'utf8');
      const processAfter = await processState();
      return { before, after, processBefore, processAfter, failures };
    });
    expect(malformed.failures).toHaveLength(7);
    expect(malformed.failures.slice(0, 4)).toEqual(
      Array.from({ length: 4 }, () =>
        expect.objectContaining({
          name: 'TypeError',
          message: expect.stringMatching(/extra or missing fields/i),
        }),
      ),
    );
    expect(malformed.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'TypeError', message: expect.stringMatching(/cwd/i) }),
        expect.objectContaining({ name: 'TypeError', message: expect.stringMatching(/binPath/i) }),
        expect.objectContaining({ name: 'TypeError', message: expect.stringMatching(/args/i) }),
      ]),
    );
    expect(malformed.after).toBe(malformed.before);
    expect(malformed.processAfter).toEqual(malformed.processBefore);
    await disposeSandbox(host);

    for (const [first, second] of [
      ['install', 'install'],
      ['install', 'run'],
      ['run', 'install'],
      ['run', 'run'],
    ] as const) {
      await createToolchainSandbox(host);
      const root = `/overlap-${first}-${second}`;
      const rejectedRoot = `${root}-rejected`;
      await seedRejectedOperationSentinel(host, rejectedRoot);
      if (first === 'install') {
        await seedStalledInstall(host, root);
        await beginStalledInstall(host, root);
      } else {
        await beginStalledRun(host, root);
      }
      const outcome = await host.evaluate(
        async ({ projectRoot, secondOperation }) => {
          const sandbox = (
            globalThis as typeof globalThis & {
              __riftyNoCoiSandbox: {
                fs: { readFile(path: string, encoding: 'utf8'): Promise<string> };
                runtime: {
                  eval(source: string): Promise<{ ok: boolean }>;
                  on(fn: (event: { type: string; chunk?: string }) => void): () => void;
                };
                toolchain: {
                  install(input: Record<string, unknown>): Promise<void>;
                  runBin(input: Record<string, unknown>): Promise<unknown>;
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
          const before = await sandbox.runtime.eval(
            'globalThis.__riftyRejectedState = JSON.stringify({ cwd: process.cwd(), argv: process.argv })',
          );
          if (!before.ok) throw new Error('rejected-operation pre-state failed');
          let rejection: { name: string; message: string };
          try {
            const call =
              secondOperation === 'install'
                ? sandbox.toolchain.install({ cwd: projectRoot, registryUrl: '/npm-registry' })
                : sandbox.toolchain.runBin({
                    cwd: projectRoot,
                    binPath: `${projectRoot}/node_modules/.bin/rejected-operation-sentinel`,
                    args: [],
                  });
            await Promise.race([
              call,
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('busy rejection timeout')), 2000),
              ),
            ]);
            rejection = { name: 'resolved', message: '' };
          } catch (error) {
            const inspected = error instanceof Error ? error : new Error(String(error));
            rejection = { name: inspected.name, message: inspected.message };
          }
          const after = await sandbox.runtime.eval(
            'globalThis.__riftyRejectedStateAfter = JSON.stringify({ cwd: process.cwd(), argv: process.argv })',
          );
          if (!after.ok) throw new Error('rejected-operation post-state failed');
          const processState = await sandbox.runtime.eval(
            `console.log('__RIFTY_REJECTED_STATE__' + JSON.stringify([globalThis.__riftyRejectedState, globalThis.__riftyRejectedStateAfter]))`,
          );
          if (!processState.ok) throw new Error('rejected-operation state read failed');
          const stateLine = output
            .join('')
            .split('\n')
            .find((line) => line.startsWith('__RIFTY_REJECTED_STATE__'));
          const exists = async (path: string) => {
            try {
              await sandbox.fs.readFile(path, 'utf8');
              return true;
            } catch {
              return false;
            }
          };
          off();
          return {
            rejection,
            dispatchMarker: await exists(`${projectRoot}/rejected-dispatch.txt`),
            installMarker: await exists(`${projectRoot}/package-lock.json`),
            sentinelOutput: output.some((chunk) => chunk.includes('__RIFTY_REJECTED_DISPATCH__')),
            processState:
              stateLine && JSON.parse(stateLine.slice('__RIFTY_REJECTED_STATE__'.length)),
          };
        },
        { projectRoot: rejectedRoot, secondOperation: second },
      );
      expect(outcome.rejection, `${first} -> ${second}`).toMatchObject({
        name: 'SandboxToolchainBusyError',
      });
      expect(outcome.dispatchMarker, `${first} -> ${second} dispatch`).toBe(false);
      expect(outcome.installMarker, `${first} -> ${second} install`).toBe(false);
      expect(outcome.sentinelOutput, `${first} -> ${second} output`).toBe(false);
      expect(outcome.processState, `${first} -> ${second} process`).toHaveLength(2);
      expect(outcome.processState?.[1], `${first} -> ${second} process`).toBe(
        outcome.processState?.[0],
      );
      await disposeSandbox(host);
    }
  } finally {
    await disposeSandbox(host);
    await host.close();
  }
});

test('runBin preserves cross-stream output before one terminal result', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    const timeline = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            fs: { writeFile(path: string, value: string): Promise<void> };
            runtime: {
              on(fn: (event: { type: string; chunk?: string }) => void): () => void;
            };
            toolchain: {
              runBin(input: Record<string, unknown>): Promise<{ exitCode: number }>;
            };
          };
        }
      ).__riftyNoCoiSandbox;
      const root = '/ordered-output';
      await sandbox.fs.writeFile(
        `${root}/node_modules/.bin/ordered-output`,
        "#!/usr/bin/env node\nimport('../ordered-output/cli.js');\n",
      );
      await sandbox.fs.writeFile(
        `${root}/node_modules/ordered-output/package.json`,
        JSON.stringify({ name: 'ordered-output', type: 'commonjs' }),
      );
      await sandbox.fs.writeFile(
        `${root}/node_modules/ordered-output/cli.js`,
        "console.log('A'); setTimeout(() => { console.error('B'); queueMicrotask(() => console.log('C')); }, 25);\n",
      );
      const entries: string[] = [];
      const off = sandbox.runtime.on((event) => {
        if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk) {
          entries.push(`${event.type}:${event.chunk}`);
        }
      });
      const result = await sandbox.toolchain.runBin({
        cwd: root,
        binPath: `${root}/node_modules/.bin/ordered-output`,
        args: [],
      });
      entries.push(`result:${result.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      off();
      return entries;
    });
    expect(timeline).toEqual(['stdout:A\n', 'stderr:B\n', 'stdout:C\n', 'result:0']);
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
