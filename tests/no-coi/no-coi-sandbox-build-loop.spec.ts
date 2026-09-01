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
const runtimeWorkerUrl = `/@fs${workspacePath}/packages/runtime-js/src/worker-entry.ts`;
const toolchainWorkerUrl = `/@fs${workspacePath}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`;
const memoryIdentityWorkerUrl = `/@fs${workspacePath}/tests/no-coi/fixtures/toolchain-memory-identity-worker.ts`;
const coiPort = Number(process.env.RIFTY_NO_COI_ORACLE_PORT ?? 5412);
const resourcePort = Number(process.env.RIFTY_NO_COI_RESOURCE_PORT ?? 5413);
const coiBaseUrl = `http://localhost:${coiPort}`;
const marker = 'no-coi-build-parity-marker';

const threadedWasmProbeExpression = `(() => {
  const NativeMemory = globalThis.WebAssembly.Memory;
  const inherited = Object.assign(Object.create({ shared: true }), { initial: 1 });
  const accessor = Object.defineProperties({}, {
    initial: { value: 1, enumerable: true },
    shared: { get: () => true, enumerable: true },
  });
  const shared = [
    ['own-literal-true', { initial: 1, shared: true }],
    ['inherited-literal-true', inherited],
    ['accessor-literal-true', accessor],
    ['own-truthy-number', { initial: 1, shared: 1 }],
    ['own-truthy-string', { initial: 1, shared: 'yes' }],
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
  readonly stderr: string;
  readonly hasToolchain: boolean;
  readonly hasCapabilityReport: boolean;
  readonly cpu: { readonly cpus: number; readonly parallelism: number; readonly hardware: number };
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
}

async function createToolchainSandbox(page: Page): Promise<{
  readonly hasToolchain: boolean;
  readonly installType: string;
  readonly runBinType: string;
  readonly report: unknown;
  readonly reportFrozen: boolean;
  readonly reportDeepFrozen: boolean;
  readonly falseFlagErrors: readonly { readonly name: string; readonly message: string }[];
}> {
  const state = await page.evaluate(
    async ({ sdkUrl, selectedToolchainWorkerUrl }) => {
      const sdk = (await import(/* @vite-ignore */ sdkUrl)) as {
        createSandbox(options: Record<string, unknown>): Promise<unknown>;
      };
      const falseFlagErrors: Array<{ name: string; message: string }> = [];
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
          falseFlagErrors.push({ name: inspected.name, message: inspected.message });
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
    expect(result.defaultError.message).toContain('cross-origin isolation is not active');
    expect(result.defaultError.message).toContain('requireCrossOriginIsolation: false');
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
      expect.objectContaining({ name: 'TypeError', message: expect.stringContaining('false') }),
      expect.objectContaining({ name: 'TypeError', message: expect.stringContaining('false') }),
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

test('build-only toolchain rejects every resident Vite mode by name', async ({ page }) => {
  const { host } = await openHeaderlessHost(page);
  try {
    await createToolchainSandbox(host);
    const outcomes = await host.evaluate(async () => {
      const sandbox = (
        globalThis as typeof globalThis & {
          __riftyNoCoiSandbox: {
            toolchain: { runBin(input: Record<string, unknown>): Promise<unknown> };
          };
        }
      ).__riftyNoCoiSandbox;
      const forms = [[], ['dev'], ['serve'], ['preview'], ['build', '--watch'], ['build', '-w']];
      const failures: Array<{ args: string[]; name: string; feature?: string }> = [];
      for (const args of forms) {
        try {
          await sandbox.toolchain.runBin({
            cwd: '/resident',
            binPath: '/resident/node_modules/.bin/vite',
            args,
          });
          failures.push({ args, name: 'resolved' });
        } catch (error) {
          const inspected = error as Error & { feature?: string };
          failures.push({ args, name: inspected.name, feature: inspected.feature });
        }
      }
      return failures;
    });
    expect(outcomes).toEqual(
      [[], ['dev'], ['serve'], ['preview'], ['build', '--watch'], ['build', '-w']].map((args) => ({
        args,
        name: 'NotImplementedError',
        feature: 'toolchain.dev-hmr',
      })),
    );
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
      expect((noCoi.output.match(/2180 modules transformed\./gu) ?? []).length).toBe(1);
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
    await renewCrossOriginImage(host);
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
    await renewCrossOriginImage(host);
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
    await renewCrossOriginImage(host);
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
                toolchain: {
                  install(input: Record<string, unknown>): Promise<void>;
                  runBin(input: Record<string, unknown>): Promise<unknown>;
                };
              };
            }
          ).__riftyNoCoiSandbox;
          try {
            if (secondOperation === 'install') {
              await sandbox.toolchain.install({ cwd: projectRoot, registryUrl: '/npm-registry' });
            } else {
              await sandbox.toolchain.runBin({
                cwd: projectRoot,
                binPath: `${projectRoot}/node_modules/.bin/second`,
                args: [],
              });
            }
            return { name: 'resolved', message: '' };
          } catch (error) {
            const inspected = error instanceof Error ? error : new Error(String(error));
            return { name: inspected.name, message: inspected.message };
          }
        },
        { projectRoot: root, secondOperation: second },
      );
      expect(outcome, `${first} -> ${second}`).toMatchObject({
        name: 'SandboxToolchainBusyError',
      });
      await disposeSandbox(host);
    }
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
