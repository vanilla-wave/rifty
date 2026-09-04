/// <reference lib="webworker" />

import { NotImplementedError } from '@riftydev/io';
import { dispatchToPort, listPorts, onRegistryChange, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { RegistryClient, install } from '@riftydev/npm-client';
import { shadowSubstitutionPlanForInstallResult } from '@riftydev/npm-client/internal';
import {
  type SerializedRuntimeError,
  awaitDrain,
  installEventLoopKeepalive,
  installFetchKeepalive,
} from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { riftyProcess, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import {
  SANDBOX_TOOLCHAIN_PROTOCOL,
  type ToolchainActivationState,
  type ToolchainRecoveryFile,
  type ToolchainRequest,
  type ToolchainResult,
} from '@riftydev/runtime-js/internal';
import { dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { declaredGapCause } from './declared-gap-cause.ts';
import { finalizeGenericPackageInstallFiles } from './package-install-generic-finalizer.ts';
import {
  type WorkbenchRuntimeBinding,
  activateWorkbenchRuntimeAdapters,
} from './workbench-runtime-adapters.ts';

declare const self: DedicatedWorkerGlobalScope;

const TOOLCHAIN_REALM = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');
Object.defineProperty(globalThis, TOOLCHAIN_REALM, {
  value: true,
  configurable: false,
  enumerable: false,
  writable: false,
});
installEventLoopKeepalive();
registerNetBuiltins();
installToolchainCloseSignal();

let runtimeBackend: 'opfs' | 'memory' | null = null;

function post(message: ToolchainResult): void {
  self.postMessage({ type: 'toolchain-result', result: message });
}

async function flushMirror(): Promise<void> {
  const mirror = syncMirror() as { flush?: () => Promise<void> };
  if (typeof mirror.flush === 'function') await mirror.flush();
}

async function activateInstallRuntime(
  cwd: string,
  result: Awaited<ReturnType<typeof install>>,
): Promise<readonly WorkbenchRuntimeBinding[]> {
  const bindings: readonly WorkbenchRuntimeBinding[] = Object.freeze(
    shadowSubstitutionPlanForInstallResult(result).bindings.map((binding) =>
      Object.freeze({
        adapterId: binding.adapterId,
        packagePath: normalizePath(`${cwd}/${binding.packagePath}`),
      }),
    ),
  );
  await activateWorkbenchRuntimeAdapters({ bindings, fs: syncMirror(), cwd });
  return bindings;
}

function snapshotFiles(): readonly ToolchainRecoveryFile[] {
  const fs = syncMirror();
  const files: ToolchainRecoveryFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = directory === '/' ? `/${entry.name}` : `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        walk(path);
        continue;
      }
      const source = fs.readFileBytesSync(path);
      const data = new Uint8Array(source.byteLength);
      data.set(source);
      files.push({ path, data });
    }
  };
  walk('/');
  return Object.freeze(files.toSorted((left, right) => left.path.localeCompare(right.path)));
}

async function installManifest(input: Extract<ToolchainRequest, { op: 'install' }>['input']) {
  const registry = new RegistryClient({ baseUrl: input.registryUrl });
  const result = await install({
    vfs: new SyncMirrorVfs(),
    cwd: input.cwd,
    registry,
  });
  finalizeGenericPackageInstallFiles({ root: input.cwd });
  const bindings = await activateInstallRuntime(input.cwd, result);
  await flushMirror();
  if (runtimeBackend === null) throw new Error('toolchain VFS backend is not ready');
  return Object.freeze({
    cwd: input.cwd,
    bindings,
    vfsBackend: runtimeBackend,
    files: snapshotFiles(),
  });
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

async function runInstalledBin(
  input: Extract<ToolchainRequest, { op: 'run-bin' }>['input'],
): Promise<{ readonly exitCode: number }> {
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
    if (signalled !== null) exitCode = signalled;
    else throw declaredGapCause(error) ?? error;
  }
  await flushMirror();
  return { exitCode };
}

let residentPort: number | null = null;

async function waitForPort(port: number, entry: Promise<void>, timeoutMs = 10_000): Promise<void> {
  let unsubscribe: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      unsubscribe = onRegistryChange((changed, action) => {
        if (action !== 'register') return;
        if (changed === port) resolve();
      });
      timer = setTimeout(
        () =>
          reject(new Error(`resident bin did not listen on port ${port} within ${timeoutMs}ms`)),
        timeoutMs,
      );
      void entry.catch(reject);
      if (listPorts().includes(port)) resolve();
    });
  } finally {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function startInstalledBin(
  input: Extract<ToolchainRequest, { op: 'start-bin' }>['input'],
): Promise<{ readonly port: number }> {
  if (residentPort !== null) {
    const error = new Error(`resident bin already owns port ${residentPort}`);
    error.name = 'SandboxResidentToolBusyError';
    throw error;
  }
  if (listPorts().includes(input.port)) {
    const error = new Error(`resident port ${input.port} is already in use`);
    Object.assign(error, { code: 'EADDRINUSE' });
    throw error;
  }
  await awaitDrain({ capMs: 1000 });
  if (listPorts().includes(input.port)) {
    const error = new Error(`resident port ${input.port} became occupied before launch`);
    Object.assign(error, { code: 'EADDRINUSE' });
    throw error;
  }
  const process = riftyProcess as unknown as { argv: string[]; exitCode?: number };
  process.argv = ['node', input.binPath, ...input.args];
  process.exitCode = undefined;
  setProcessCwd(input.cwd);
  const entry = runNodeEntry({
    vfs: syncMirror(),
    entryPath: input.binPath,
    cwd: input.cwd,
    bin: true,
  });
  await waitForPort(input.port, entry);
  residentPort = input.port;
  serveCrossRealmPreview(input.port, (request) => dispatchToPort(input.port, request));
  void entry.catch((error: unknown) => {
    queueMicrotask(() => {
      throw error;
    });
  });
  return { port: input.port };
}

async function restoreActivation(state: ToolchainActivationState): Promise<void> {
  if (runtimeBackend === null) throw new Error('toolchain VFS backend is not ready');
  if (runtimeBackend === 'memory' || runtimeBackend !== state.vfsBackend) {
    const fs = syncMirror();
    for (const file of state.files) {
      fs.mkdirSync(dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.data);
    }
    await flushMirror();
  }
  await activateWorkbenchRuntimeAdapters({
    bindings: state.bindings,
    fs: syncMirror(),
    cwd: state.cwd,
  });
}

async function dispatch(
  request: ToolchainRequest,
): Promise<
  | { readonly exitCode: number }
  | { readonly port: number }
  | { readonly activationState: ToolchainActivationState }
  | undefined
> {
  if (residentPort !== null && (request.op === 'install' || request.op === 'run-bin')) {
    throw new NotImplementedError(
      'sandbox.toolchain.resident-concurrency',
      'install/runBin while a resident bin is active is not supported',
    );
  }
  if (request.op === 'install') {
    return { activationState: await installManifest(request.input) };
  }
  if (request.op === 'run-bin') return await runInstalledBin(request.input);
  if (request.op === 'start-bin') return await startInstalledBin(request.input);
  await restoreActivation(request.input);
  return undefined;
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
      (error: unknown) => {
        post({ id: request.id, ok: false, error: serializedError(error) });
        if (request.op === 'start-bin' && residentPort === null) {
          setTimeout(() => self.close(), 0);
        }
      },
    )
    .finally(() => {
      busy = false;
    });
});

void import('@riftydev/runtime-js/worker')
  .then(({ runtimeWorkerBackend }) => runtimeWorkerBackend)
  .then((vfsBackend) => {
    runtimeBackend = vfsBackend;
    installFetchKeepalive();
    self.postMessage({ type: 'toolchain-ready', protocol: SANDBOX_TOOLCHAIN_PROTOCOL, vfsBackend });
  });

function installToolchainCloseSignal(): void {
  const closeWorker = self.close.bind(self);
  let signalled = false;
  Object.defineProperty(self, 'close', {
    configurable: true,
    enumerable: false,
    writable: false,
    value() {
      if (!signalled) {
        signalled = true;
        self.postMessage({ type: 'toolchain-terminal', reason: 'closed' });
      }
      closeWorker();
    },
  });
}
