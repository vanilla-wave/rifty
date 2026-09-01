/// <reference lib="webworker" />

import { NotImplementedError } from '@riftydev/io';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { RegistryClient, install } from '@riftydev/npm-client';
import {
  createMemoryShadowAssetStorage,
  createOriginExclusiveShadowAssetManager,
  createRegistryShadowAssetSource,
  createShadowAssetPortClient,
  shadowAssetPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import {
  SANDBOX_TOOLCHAIN_PROTOCOL,
  type SerializedRuntimeError,
  type ToolchainRequest,
  type ToolchainResult,
  awaitDrain,
  installEventLoopKeepalive,
  installFetchKeepalive,
} from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { riftyProcess, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { runtimeWorkerBackend } from '@riftydev/runtime-js/worker';
import { syncMirror } from '@riftydev/vfs';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { finalizePackageInstallFiles } from './package-install-finalizer.ts';
import { prepareViteCli, viteCliPreparationFromArgs } from './vite-cli-prep.ts';
import {
  type WorkbenchRuntimeAssetClient,
  activateWorkbenchRuntimeAdapters,
} from './workbench-runtime-adapters.ts';

declare const self: DedicatedWorkerGlobalScope;

installEventLoopKeepalive();
registerNetBuiltins();
installThreadedWasmBoundary();

function post(message: ToolchainResult): void {
  self.postMessage({ type: 'toolchain-result', result: message });
}

async function flushMirror(): Promise<void> {
  const mirror = syncMirror() as { flush?: () => Promise<void> };
  if (typeof mirror.flush === 'function') await mirror.flush();
}

async function activateInstallRuntime(
  cwd: string,
  registry: RegistryClient,
  result: Awaited<ReturnType<typeof install>>,
): Promise<void> {
  const manager = createOriginExclusiveShadowAssetManager({
    storage: createMemoryShadowAssetStorage(),
    source: createRegistryShadowAssetSource(registry),
  });
  let server: { dispose(): void } | undefined;
  try {
    const ready = await manager.ensure(shadowAssetPlanForInstallResult(result));
    const channel = new MessageChannel();
    server = manager.serve(ready, channel.port2);
    const client: WorkbenchRuntimeAssetClient = createShadowAssetPortClient(channel.port1);
    await activateWorkbenchRuntimeAdapters({ assets: client, fs: syncMirror(), cwd });
  } finally {
    server?.dispose();
    await manager.close();
  }
}

async function installManifest(input: Extract<ToolchainRequest, { op: 'install' }>['input']) {
  const registry = new RegistryClient({ baseUrl: input.registryUrl });
  const result = await install({
    vfs: new SyncMirrorVfs(),
    cwd: input.cwd,
    registry,
  });
  await finalizePackageInstallFiles({ root: input.cwd });
  await activateInstallRuntime(input.cwd, registry, result);
  await flushMirror();
}

interface ProcessExitSignal {
  readonly code?: unknown;
  readonly exitCode?: unknown;
}

function processExitCode(error: unknown): number | null {
  const signal = error as ProcessExitSignal;
  return signal?.code === 'RIFTY_PROCESS_EXIT' && typeof signal.exitCode === 'number'
    ? signal.exitCode
    : null;
}

function viteVersion(cwd: string): string | null {
  const path = `${cwd}/node_modules/vite/package.json`;
  const fs = syncMirror();
  if (!fs.existsSync(path)) return null;
  const manifest = JSON.parse(new TextDecoder().decode(fs.readFileBytesSync(path))) as {
    readonly name?: unknown;
    readonly version?: unknown;
  };
  return manifest.name === 'vite' && typeof manifest.version === 'string' ? manifest.version : null;
}

function rejectThreadedVite(cwd: string, binPath: string): void {
  if (!binPath.endsWith('/node_modules/.bin/vite')) return;
  const version = viteVersion(cwd);
  if (version === null || !/^8\./u.test(version) || globalThis.crossOriginIsolated === true) return;
  throw new NotImplementedError(
    'toolchain.threaded-wasm',
    `Vite ${version} uses Rolldown's WASI pthread runtime, which requires cross-origin isolation and SharedArrayBuffer.`,
  );
}

async function runInstalledBin(
  input: Extract<ToolchainRequest, { op: 'run-bin' }>['input'],
): Promise<{ readonly exitCode: number }> {
  const preparation = viteCliPreparationFromArgs({
    root: input.cwd,
    args: input.args,
    executedBinPath: input.binPath,
  });
  if (preparation?.mode === 'dev' || preparation?.mode === 'preview') {
    throw new NotImplementedError(
      'toolchain.dev-hmr',
      'resident Vite dev/preview lifecycle is unavailable in the build-only toolchain mode',
    );
  }
  rejectThreadedVite(input.cwd, input.binPath);
  if (preparation !== null) await prepareViteCli(preparation);

  const process = riftyProcess as unknown as { argv: string[]; exitCode?: number };
  process.argv = ['node', input.binPath, ...input.args];
  process.exitCode = undefined;
  setProcessCwd(input.cwd);
  let exitCode = 0;
  try {
    await runNodeEntry({
      vfs: syncMirror(),
      entryPath: input.binPath,
      cwd: input.cwd,
      bin: true,
    });
    await awaitDrain({ capMs: 600_000 });
    if (typeof process.exitCode === 'number') exitCode = process.exitCode;
  } catch (error) {
    const signalled = processExitCode(error);
    if (signalled === null) throw error;
    exitCode = signalled;
  }
  await flushMirror();
  return { exitCode };
}

async function dispatch(
  request: ToolchainRequest,
): Promise<{ readonly exitCode: number } | undefined> {
  if (request.op === 'install') {
    await installManifest(request.input);
    return undefined;
  }
  return await runInstalledBin(request.input);
}

function serializedError(error: unknown): SerializedRuntimeError {
  const inspected = error instanceof Error ? error : new Error(String(error));
  const details = inspected as Error & {
    readonly code?: unknown;
    readonly path?: unknown;
    readonly feature?: unknown;
  };
  return {
    name: inspected.name,
    message: inspected.message,
    ...(inspected.stack === undefined ? {} : { stack: inspected.stack }),
    ...(typeof details.code === 'string' ? { code: details.code } : {}),
    ...(typeof details.path === 'string' ? { path: details.path } : {}),
    ...(typeof details.feature === 'string' ? { feature: details.feature } : {}),
  };
}

let busy = false;
self.addEventListener('message', (event: MessageEvent<{ type?: unknown; request?: unknown }>) => {
  if (event.data?.type !== 'toolchain') return;
  const request = event.data.request as ToolchainRequest;
  if (busy) {
    const error = new Error('another sandbox toolchain operation is already active');
    error.name = 'SandboxToolchainBusyError';
    post({ id: request.id, ok: false, error: serializedError(error) });
    return;
  }
  busy = true;
  void dispatch(request)
    .then(
      (value) => post({ id: request.id, ok: true, ...(value === undefined ? {} : { value }) }),
      (error: unknown) => post({ id: request.id, ok: false, error: serializedError(error) }),
    )
    .finally(() => {
      busy = false;
    });
});

void runtimeWorkerBackend.then((vfsBackend) => {
  installFetchKeepalive();
  self.postMessage({ type: 'toolchain-ready', protocol: SANDBOX_TOOLCHAIN_PROTOCOL, vfsBackend });
});

function installThreadedWasmBoundary(): void {
  const NativeMemory = WebAssembly.Memory;
  class SharedMemoryFreeMemory extends NativeMemory {
    constructor(descriptor: WebAssembly.MemoryDescriptor) {
      if (descriptor.shared === true) {
        throw new NotImplementedError(
          'toolchain.threaded-wasm',
          'shared WebAssembly.Memory requires cross-origin isolation and SharedArrayBuffer',
        );
      }
      super(descriptor);
    }
  }
  Object.defineProperty(WebAssembly, 'Memory', {
    ...Object.getOwnPropertyDescriptor(WebAssembly, 'Memory'),
    value: SharedMemoryFreeMemory,
  });
}
