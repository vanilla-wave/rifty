import { bridgeCrossRealmPreview, registerPort, unregisterPort } from '@riftydev/net';
import {
  type RuntimeController,
  type RuntimeEvent,
  type RuntimeFs,
  type RuntimeOptions,
  spawnRuntime,
} from '@riftydev/runtime-js';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import {
  type ToolchainInstallRequest,
  type ToolchainRunBinRequest,
  type ToolchainRuntimeController,
  spawnToolchainRuntime,
} from '@riftydev/runtime-js/internal';
import {
  type SerializedRequest,
  type SerializedResponse,
  registerServiceWorker,
  setupPreviewBridge,
} from '@riftydev/service-worker';
import { initBackend } from '@riftydev/vfs';
import type { CapabilityCheck } from './capabilities.ts';

/** Which VFS backend booted. */
export type VfsBackend = 'opfs' | 'memory';

export interface VfsBootInfo {
  readonly backend: VfsBackend;
  /** Set only when OPFS init failed and the sandbox fell back to memory. */
  readonly reason?: string;
}

interface CreateSandboxCommonOptions {
  /**
   * Service-worker script URL used for preview/HMR routing. Default `/sw.js`.
   * Must be same-origin and registrable at a scope covering the preview routes.
   */
  readonly serviceWorkerUrl?: string;
  /** Skip service-worker registration (eval-only / headless use). Default false. */
  readonly skipServiceWorker?: boolean;
  /** Sink for the non-fatal fallback warnings. Default `console`. */
  readonly logger?: Pick<Console, 'warn' | 'error'>;
}

export interface GenericCreateSandboxOptions extends CreateSandboxCommonOptions {
  /** Require COI by default; explicit false admits the generic no-COI baseline. */
  readonly requireCrossOriginIsolation?: boolean;
  /** Bundler-resolved generic `@riftydev/runtime-js/worker` URL. */
  readonly workerUrl: string | URL;
  readonly toolchain?: undefined;
}

export interface ToolchainCreateSandboxOptions extends CreateSandboxCommonOptions {
  /** Explicit admission for the shared-memory-free tier. */
  readonly requireCrossOriginIsolation: false;
  /** Bundler-resolved `@riftydev/workbench/no-coi-toolchain-worker` URL. */
  readonly toolchain: { readonly workerUrl: string | URL };
}

export type CreateSandboxOptions = GenericCreateSandboxOptions | ToolchainCreateSandboxOptions;

export type SandboxCapabilityFeature =
  | { readonly feature: string; readonly status: 'working' }
  | {
      readonly feature: string;
      readonly status: 'degraded';
      readonly warning: string;
      readonly value?: number;
    }
  | {
      readonly feature: string;
      readonly status: 'throwing';
      readonly error: { readonly name: 'NotImplementedError'; readonly feature: string };
    };

export interface SandboxCapabilityReport {
  readonly schemaVersion: 1;
  readonly tier: 'shared-memory-free';
  readonly features: readonly SandboxCapabilityFeature[];
}

export interface SandboxResidentBin {
  readonly port: number;
  readonly previewUrl: string;
}

export interface SandboxStartBinInput {
  readonly cwd: string;
  readonly binPath: string;
  readonly args: readonly string[];
  readonly port: number;
}

export interface SandboxToolchain {
  install(input: ToolchainInstallRequest): Promise<void>;
  runBin(input: ToolchainRunBinRequest): Promise<{ readonly exitCode: number }>;
  startBin(input: SandboxStartBinInput): Promise<SandboxResidentBin>;
}

export interface SandboxPreviewTarget {
  src: string;
}

export interface SandboxRestartOptions {
  readonly preview: SandboxPreviewTarget;
  readonly beforeStart?: (fs: RuntimeFs) => void | Promise<void>;
}

export interface SandboxRestartReport {
  readonly unflushedWrites: boolean;
  readonly resident: SandboxResidentBin | null;
}

export interface Sandbox {
  /** Framework-agnostic JS runtime controller (`eval` / `reset` / `on` / …). */
  readonly runtime: RuntimeController;
  /**
   * Worker-owned filesystem RPC surface for AI-agent style file IO. Paths
   * anchor at the VFS root (`/`), not the guest cwd — see `RuntimeFs` TSDoc.
   */
  readonly fs: RuntimeFs;
  /**
   * Which VFS backend booted. Generic mode reports the page-realm probe; toolchain
   * mode reports its one authoritative runtime Worker backend.
   */
  readonly vfs: VfsBootInfo;
  /** Capability probe taken at boot. */
  readonly capabilities: CapabilityCheck;
  /** Set only when service-worker registration failed (preview unavailable, rest works). */
  readonly swError?: string;
  /**
   * Tear down the runtime worker. Realm-global state (the VFS backend and the
   * registered service worker) is intentionally left in place — see the
   * realm-scoped note on {@link createSandbox}.
   */
  dispose(): void;
}

export interface ToolchainSandbox extends Sandbox {
  readonly toolchain: SandboxToolchain;
  readonly capabilityReport: SandboxCapabilityReport;
  restart(options: SandboxRestartOptions): Promise<SandboxRestartReport>;
}

/**
 * Test injection seam — mirrors the playground `boot.ts` pattern so the boot
 * pipeline is unit-testable without a DOM, Worker, or OPFS. Every field defaults
 * to the real implementation.
 */
export interface SandboxDeps {
  readonly detect?: () => CapabilityCheck;
  readonly initVfs?: () => Promise<VfsBackend>;
  readonly registerSw?: (url: string) => Promise<unknown>;
  readonly spawn?: (opts: RuntimeOptions) => RuntimeController;
  readonly logger?: Pick<Console, 'warn' | 'error'>;
}

const TOOLCHAIN_CAPABILITY_REPORT = freezeDeep({
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
} satisfies SandboxCapabilityReport);

export const COI_REQUIRED_MESSAGE =
  'rifty: cross-origin isolation is not active — SharedArrayBuffer and Atomics ' +
  'are unavailable, so sync IPC cannot start. Serve with COOP/COEP headers ' +
  '(Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: ' +
  'require-corp or credentialless), or pass requireCrossOriginIsolation: false ' +
  'to bypass this guard.';

/**
 * Boot a rifty sandbox in one call (EPIC B / B2): probe capabilities →
 * (optionally) assert cross-origin isolation → bring up the VFS backend (OPFS,
 * falling back to memory) → (optionally) register the preview service worker →
 * spawn the JS runtime worker. Framework-free: no DOM, no Solid — it returns a
 * live {@link RuntimeController}, the same one the playground drives.
 *
 * Boot order is load-bearing and matches the playground: COI must hold before
 * any SAB-backed IPC, and the VFS surface must exist before the first `fs.*`.
 * Degradations are non-fatal and surfaced on the result — VFS init failure
 * falls back to memory (`vfs.reason`), SW registration failure sets `swError`.
 *
 * **Realm-scoped (v0.1).** Generic mode's page VFS and the service worker are
 * realm-global singletons (ADR-0070 D4). Toolchain mode owns VFS/runtime inside
 * its selected Worker. {@link Sandbox.dispose} tears down only that Worker; the
 * service-worker registration persists. Register your
 * `sandbox.runtime.on(...)` handler immediately after this resolves so you don't
 * miss early `ready` / `stdout` events (the controller does not replay them).
 *
 * @param options - generic or explicit toolchain Worker configuration.
 * @param deps - test-only injection seam; leave empty in production.
 */
export function createSandbox(
  options: ToolchainCreateSandboxOptions,
  deps?: SandboxDeps,
): Promise<ToolchainSandbox>;
export function createSandbox(
  options: GenericCreateSandboxOptions,
  deps?: SandboxDeps,
): Promise<Sandbox>;
export function createSandbox(
  options: CreateSandboxOptions,
  deps?: SandboxDeps,
): Promise<Sandbox | ToolchainSandbox>;
export async function createSandbox(
  options: CreateSandboxOptions,
  deps: SandboxDeps = {},
): Promise<Sandbox | ToolchainSandbox> {
  const requireCrossOriginIsolation: unknown = options.requireCrossOriginIsolation;
  if (
    (requireCrossOriginIsolation !== undefined ||
      Object.hasOwn(options, 'requireCrossOriginIsolation')) &&
    typeof requireCrossOriginIsolation !== 'boolean'
  ) {
    throw new TypeError(
      'sandbox requireCrossOriginIsolation must be a boolean; use literal false to disable isolation',
    );
  }
  const logger = deps.logger ?? options.logger ?? console;
  const detect = deps.detect ?? detectCapabilities;
  const capabilities = detect();

  if (options.toolchain !== undefined && requireCrossOriginIsolation !== false) {
    throw new TypeError('sandbox toolchain mode requires requireCrossOriginIsolation: false');
  }
  if ((requireCrossOriginIsolation ?? true) && !capabilities.capabilities.crossOriginIsolated) {
    throw new Error(COI_REQUIRED_MESSAGE);
  }

  if (options.toolchain !== undefined) {
    const { swError } = await bootServiceWorker(options, deps, logger);
    return bootToolchainSandbox({
      workerUrl: String(options.toolchain.workerUrl),
      capabilities,
      ...(swError === undefined ? {} : { swError }),
    });
  }

  const vfs = await bootVfs(deps.initVfs ?? initBackend, logger);
  const { swError } = await bootServiceWorker(options, deps, logger);

  const spawn = deps.spawn ?? spawnRuntime;
  const runtime = spawn({ workerUrl: String(options.workerUrl) });

  return {
    runtime,
    fs: runtime.fs,
    vfs,
    capabilities,
    ...(swError === undefined ? {} : { swError }),
    dispose() {
      runtime.dispose();
    },
  };
}

function previewUrl(port: number): string {
  return `/preview/${port}/`;
}

function mountToolchainPreview(port: number, ownerToken: string): () => void {
  const bridge = bridgeCrossRealmPreview(port);
  registerPort(port, bridge);
  const tearSw = setupPreviewBridge(
    async (request: SerializedRequest): Promise<SerializedResponse> => {
      const response = await bridge.dispatchStruct({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body ?? null,
      });
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        body: response.body,
      };
    },
    { ownerToken, ports: [port] },
  );
  return (): void => {
    tearSw();
    unregisterPort(port);
    bridge.dispose();
  };
}

async function bootToolchainSandbox(options: {
  readonly workerUrl: string;
  readonly capabilities: CapabilityCheck;
  readonly swError?: string;
}): Promise<ToolchainSandbox> {
  let current: ToolchainRuntimeController = spawnToolchainRuntime({
    workerUrl: options.workerUrl,
  });
  let backend: VfsBackend;
  try {
    backend = await current.toolchainReady;
  } catch (error) {
    current.dispose();
    throw error;
  }

  const ownerToken = `sdk-${crypto.randomUUID()}`;
  const handlers = new Set<(event: RuntimeEvent) => void>();
  let detachCurrent: () => void = () => {};
  let tearPreview: (() => void) | null = null;
  let pendingWrites = 0;
  let unflushedMarker = false;
  let restarting = false;
  let disposed = false;
  let generation = 0;
  let activation = current.snapshotToolchainState();
  let residentRequest = current.snapshotResidentRequest();

  const emit = (event: RuntimeEvent): void => {
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('runtime listener threw', error);
      }
    }
  };

  const attachCurrent = (): void => {
    detachCurrent();
    detachCurrent = current.on((event) => {
      if (event.type === 'exit' && event.reason === 'error') {
        if (pendingWrites > 0) unflushedMarker = true;
        tearPreview?.();
        tearPreview = null;
      }
      emit(event);
    });
  };
  attachCurrent();

  function assertLive(): void {
    if (disposed) throw new Error('Sandbox is disposed');
  }

  function restartBusyError(): Error {
    const error = new Error('sandbox restart is already active');
    error.name = 'SandboxRestartBusyError';
    return error;
  }

  function assertOperable(): void {
    assertLive();
    if (restarting) throw restartBusyError();
  }

  function readFile(path: string): Promise<Uint8Array>;
  function readFile(
    path: string,
    encoding: 'utf8' | { readonly encoding: 'utf8' },
  ): Promise<string>;
  async function readFile(
    path: string,
    encoding?: 'utf8' | { readonly encoding: 'utf8' },
  ): Promise<Uint8Array | string> {
    assertOperable();
    return encoding === undefined
      ? await current.fs.readFile(path)
      : await current.fs.readFile(path, encoding);
  }

  async function trackedWrite(
    target: ToolchainRuntimeController,
    path: string,
    data: string | Uint8Array,
  ): Promise<void> {
    pendingWrites += 1;
    try {
      await target.fs.writeFile(path, data);
    } finally {
      pendingWrites -= 1;
    }
  }

  function callbackFs(target: ToolchainRuntimeController): RuntimeFs {
    function readCallbackFile(path: string): Promise<Uint8Array>;
    function readCallbackFile(
      path: string,
      encoding: 'utf8' | { readonly encoding: 'utf8' },
    ): Promise<string>;
    function readCallbackFile(
      path: string,
      encoding?: 'utf8' | { readonly encoding: 'utf8' },
    ): Promise<Uint8Array | string> {
      return encoding === undefined ? target.fs.readFile(path) : target.fs.readFile(path, encoding);
    }
    return {
      readFile: readCallbackFile,
      writeFile: (path, data) => trackedWrite(target, path, data),
    };
  }

  const fs: RuntimeFs = {
    readFile,
    async writeFile(path, data) {
      assertOperable();
      await trackedWrite(current, path, data);
    },
  };

  const runtime: RuntimeController = {
    async eval(code, evalOptions) {
      assertOperable();
      return await current.eval(code, evalOptions);
    },
    fs,
    writeStdin(data) {
      assertOperable();
      current.writeStdin(data);
    },
    async reset() {
      assertOperable();
      return await current.reset();
    },
    dispose() {
      disposeSandbox();
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    writeFile(path, content) {
      assertOperable();
      current.writeFile(path, content);
    },
    isReady: () => !disposed && !restarting && current.isReady(),
  };

  const mountResidentPreview = (port: number): SandboxResidentBin => {
    tearPreview?.();
    tearPreview = mountToolchainPreview(port, ownerToken);
    return { port, previewUrl: previewUrl(port) };
  };

  const toolchain: SandboxToolchain = {
    async install(input) {
      assertOperable();
      await current.toolchain.install(input);
      activation = current.snapshotToolchainState();
    },
    async runBin(input) {
      assertOperable();
      return await current.toolchain.runBin(input);
    },
    async startBin(input) {
      assertOperable();
      const resident = await current.toolchain.startBin(input);
      residentRequest = current.snapshotResidentRequest();
      return mountResidentPreview(resident.port);
    },
  };
  Object.defineProperty(runtime, 'toolchain', {
    value: toolchain,
    configurable: false,
    enumerable: true,
    writable: false,
  });

  function disposeSandbox(): void {
    if (disposed) return;
    disposed = true;
    tearPreview?.();
    tearPreview = null;
    detachCurrent();
    current.dispose();
    handlers.clear();
  }

  async function restart(restartOptions: SandboxRestartOptions): Promise<SandboxRestartReport> {
    assertLive();
    if (restarting) {
      throw restartBusyError();
    }
    restarting = true;
    try {
      if (restartOptions === null || typeof restartOptions !== 'object') {
        throw new TypeError('sandbox restart options must be an object');
      }
      const preview = restartOptions.preview;
      const beforeStart = restartOptions.beforeStart;
      if (preview === null || typeof preview !== 'object' || typeof preview.src !== 'string') {
        throw new TypeError('sandbox restart preview must expose a string src');
      }
      if (beforeStart !== undefined && typeof beforeStart !== 'function') {
        throw new TypeError('sandbox restart beforeStart must be a function');
      }

      const currentActivation = current.snapshotToolchainState();
      if (currentActivation !== null) activation = currentActivation;
      if (pendingWrites > 0) unflushedMarker = true;
      tearPreview?.();
      tearPreview = null;
      detachCurrent();
      emit({ type: 'exit', reason: 'reset' });
      if (pendingWrites > 0) unflushedMarker = true;
      if (disposed) throw new Error('Sandbox was disposed during restart');
      current.dispose();

      current = spawnToolchainRuntime({ workerUrl: options.workerUrl });
      attachCurrent();
      backend = await current.toolchainReady;
      if (activation !== null) await current.restoreToolchainState(activation);
      try {
        await beforeStart?.(callbackFs(current));
      } finally {
        activation = current.snapshotToolchainState();
      }

      let resident: SandboxResidentBin | null = null;
      if (residentRequest !== null) {
        const started = await current.toolchain.startBin(residentRequest);
        residentRequest = current.snapshotResidentRequest();
        resident = mountResidentPreview(started.port);
        generation += 1;
        preview.src = `${resident.previewUrl}?riftyRestart=${generation}`;
      }
      const unflushedWrites = unflushedMarker;
      unflushedMarker = false;
      return { unflushedWrites, resident };
    } finally {
      restarting = false;
    }
  }

  return {
    runtime,
    fs,
    get vfs() {
      return { backend };
    },
    capabilities: options.capabilities,
    toolchain,
    capabilityReport: TOOLCHAIN_CAPABILITY_REPORT,
    ...(options.swError === undefined ? {} : { swError: options.swError }),
    restart,
    dispose: disposeSandbox,
  };
}

async function bootServiceWorker(
  options: CreateSandboxOptions,
  deps: SandboxDeps,
  logger: Pick<Console, 'warn'>,
): Promise<{ readonly swError?: string }> {
  if (options.skipServiceWorker) return {};
  const registerSw = deps.registerSw ?? ((url: string) => registerServiceWorker(url));
  try {
    await registerSw(options.serviceWorkerUrl ?? '/sw.js');
    return {};
  } catch (err) {
    const swError = reasonOf(err);
    logger.warn(`[rifty] service worker registration failed: ${swError}`);
    return { swError };
  }
}

/** Resolve the VFS backend, catching init failure and degrading to memory. Never throws. */
async function bootVfs(
  initVfs: () => Promise<VfsBackend>,
  logger: Pick<Console, 'warn'>,
): Promise<VfsBootInfo> {
  try {
    return { backend: await initVfs() };
  } catch (err) {
    const reason = reasonOf(err);
    logger.warn(`[rifty] VFS backend init failed, falling back to memory: ${reason}`);
    return { backend: 'memory', reason };
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeDeep(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}
