/// <reference lib="webworker" />

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
  type ToolchainRequest,
  type ToolchainResult,
} from '@riftydev/runtime-js/internal';
import { normalizePath, syncMirror } from '@riftydev/vfs';
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
): Promise<void> {
  const bindings: readonly WorkbenchRuntimeBinding[] = Object.freeze(
    shadowSubstitutionPlanForInstallResult(result).bindings.map((binding) =>
      Object.freeze({
        adapterId: binding.adapterId,
        packagePath: normalizePath(`${cwd}/${binding.packagePath}`),
      }),
    ),
  );
  await activateWorkbenchRuntimeAdapters({ bindings, fs: syncMirror(), cwd });
}

async function installManifest(input: Extract<ToolchainRequest, { op: 'install' }>['input']) {
  const registry = new RegistryClient({ baseUrl: input.registryUrl });
  const result = await install({
    vfs: new SyncMirrorVfs(),
    cwd: input.cwd,
    registry,
  });
  finalizeGenericPackageInstallFiles({ root: input.cwd });
  await activateInstallRuntime(input.cwd, result);
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

void import('@riftydev/runtime-js/worker')
  .then(({ runtimeWorkerBackend }) => runtimeWorkerBackend)
  .then((vfsBackend) => {
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
