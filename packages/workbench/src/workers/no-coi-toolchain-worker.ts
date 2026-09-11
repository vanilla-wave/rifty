import { setSyncMirror } from '@riftydev/vfs/internal';
import { createNoCoiProjectFs } from './no-coi-project-fs.ts';
/// <reference lib="webworker" />

import { NotImplementedError } from '@riftydev/io';
import { dispatchToPort, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import {
  type SerializedRuntimeError,
  awaitDrain,
  installEventLoopKeepalive,
  installFetchKeepalive,
  trackKeepalivePromise,
} from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { riftyProcess, setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import {
  SANDBOX_TOOLCHAIN_PROTOCOL,
  type ToolchainActivationState,
  type ToolchainCommandResult,
  type ToolchainRecoveryFile,
  type ToolchainRequest,
  type ToolchainResult,
  type ToolchainResultValue,
  checkedRuntimeFsFlush,
  claimSandboxToolchainResidentTransition,
  handleWorkerFsRequest,
  invalidateRuntimeWorkerModules,
  releaseSandboxToolchainResidentTransition,
  setRuntimeWorkerFsComposition,
  takeUnhandledRejection,
  validateCommandInput,
  validateProjectOptions,
} from '@riftydev/runtime-js/internal';
import { dirname, syncMirror } from '@riftydev/vfs';
import { INSTALL_STAMP_BASENAME, readInstallStamp } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { declaredGapCause } from './declared-gap-cause.ts';
import { createNoCoiInstallContext } from './no-coi-install-context.ts';
import { startResidentNodeEntry } from './resident-node-entry.ts';

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
const closeToolchainWorker = installToolchainCloseSignal();
Reflect.set(globalThis, '__riftyTrackCliPromise', trackKeepalivePromise);

let runtimeBackend: 'opfs' | 'memory' | null = null;
let installContext: ReturnType<typeof createNoCoiInstallContext>;
let projectContext: ReturnType<typeof createNoCoiProjectFs>;
let activationCwd: string | null = null;
let activationBindings: ToolchainActivationState['bindings'] = [];
let activeCommand: { id: number; controller: AbortController } | null = null;
setRuntimeWorkerFsComposition(() => {
  installContext = createNoCoiInstallContext();
  projectContext = createNoCoiProjectFs(installContext.fs);
  setSyncMirror(projectContext.fs, { async: new SyncMirrorVfs() });
});

function installationSlug(registryUrl: string): string {
  return JSON.stringify(['rifty.no-coi-install/v1', registryUrl]);
}

function post(message: ToolchainResult): void {
  self.postMessage({ type: 'toolchain-result', result: message });
}

async function flushMirror(): Promise<void> {
  await checkedRuntimeFsFlush(() => installContext.fs.flush());
}

function snapshotFiles(): {
  files: readonly ToolchainRecoveryFile[];
  directories: readonly string[];
} {
  const fs = syncMirror();
  const files: ToolchainRecoveryFile[] = [];
  const directories: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = directory === '/' ? `/${entry.name}` : `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        directories.push(path);
        walk(path);
        continue;
      }
      // postMessage takes byte ownership through structured clone before the next task.
      files.push({ path, data: installContext.readRecoveryFile(path) });
    }
  };
  walk('/');
  return {
    files: Object.freeze(files.toSorted((left, right) => left.path.localeCompare(right.path))),
    directories: Object.freeze(directories.toSorted()),
  };
}

function activationSnapshot(
  cwd: string,
  bindings: ToolchainActivationState['bindings'],
): ToolchainActivationState {
  if (runtimeBackend === null) throw new Error('toolchain VFS backend is not ready');
  activationCwd = cwd;
  activationBindings = bindings;
  return Object.freeze({ cwd, bindings, vfsBackend: runtimeBackend, ...snapshotFiles() });
}

async function installManifest(input: Extract<ToolchainRequest, { op: 'install' }>['input']) {
  const { installToolchainPackages } = await import('./no-coi-toolchain-install.ts');
  const identity = {
    root: input.cwd,
    slug: installationSlug(input.registryUrl),
    packageJsonText: new TextDecoder().decode(
      syncMirror().readFileBytesSync(`${input.cwd}/package.json`),
    ),
  };
  const flush = () => installContext.fs.flush();
  // ADR-0307: nested installation is an installer event in each ancestor tree.
  const parts = input.cwd.split('/');
  for (let index = 1; index < parts.length; index++) {
    if (parts[index] !== 'node_modules') continue;
    const root = parts.slice(0, index).join('/') || '/';
    const prior = await readInstallStamp(new SyncMirrorVfs(), root);
    if (prior === null) continue;
    const ancestorClaim = await installContext.stamps.demote({ root, slug: prior.slug }, { flush });
    await installContext.stamps.prepareTreeMutation(ancestorClaim);
  }
  const claim = await installContext.stamps.demote(identity, { flush });
  await installContext.stamps.prepareTreeMutation(claim);
  const result = await installToolchainPackages(input, installContext.installerVfs);
  await flushMirror();
  const promotion = await installContext.stamps.promote(identity, {
    epoch: claim.epoch,
    packages: result.packages,
    flush,
  });
  if (promotion.status !== 'trusted') {
    throw new Error(`installation persistence proof refused: ${JSON.stringify(promotion)}`);
  }
  await flushMirror();
  return activationSnapshot(input.cwd, result.bindings);
}

async function openInstallation(input: Extract<ToolchainRequest, { op: 'open' }>['input']) {
  const { prepareSavedToolchain } = await import('./no-coi-toolchain-install.ts');
  const bindings = await prepareSavedToolchain(input.cwd);
  return activationSnapshot(input.cwd, bindings);
}

async function applySnapshot(input: Extract<ToolchainRequest, { op: 'apply-snapshot' }>['input']) {
  const { applyNoCoiSnapshot } = await import('./no-coi-snapshot-application.ts');
  const bindings = await applyNoCoiSnapshot(input, {
    fs: installContext.applicationFs,
    flush: () => installContext.fs.flush(),
  });
  const { activateWorkbenchRuntimeAdapters } = await import('./no-coi-toolchain-install.ts');
  await activateWorkbenchRuntimeAdapters({ bindings, fs: syncMirror(), cwd: input.cwd });
  return activationSnapshot(input.cwd, bindings);
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
  const { prepareSavedToolchain } = await import('./no-coi-toolchain-install.ts');
  await prepareSavedToolchain(input.cwd);
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
    const pendingRejection = takeUnhandledRejection();
    const failure = pendingRejection === null ? error : pendingRejection.reason;
    const signalled = processExitCode(failure);
    if (signalled !== null) exitCode = signalled;
    else throw declaredGapCause(failure) ?? failure;
  }
  await flushMirror();
  return { exitCode };
}

let residentPort: number | null = null;

async function startInstalledBin(
  input: Extract<ToolchainRequest, { op: 'start-bin' }>['input'],
): Promise<{ readonly port: number }> {
  if (residentPort !== null) {
    const error = new Error(`resident bin already owns port ${residentPort}`);
    error.name = 'SandboxResidentToolBusyError';
    throw error;
  }
  if (!claimSandboxToolchainResidentTransition()) {
    const error = new Error('resident launch transition is already active');
    error.name = 'SandboxToolchainBusyError';
    throw error;
  }
  try {
    const { prepareSavedToolchain } = await import('./no-coi-toolchain-install.ts');
    await prepareSavedToolchain(input.cwd);
    const started = await startResidentNodeEntry({
      vfs: syncMirror(),
      entryPath: input.binPath,
      cwd: input.cwd,
      args: input.args,
      requestedPort: input.port,
    });
    residentPort = started.port;
    serveCrossRealmPreview(started.port, (request) => dispatchToPort(started.port, request));
    void started.completion.catch((error: unknown) => {
      queueMicrotask(() => {
        throw error;
      });
    });
    return { port: started.port };
  } finally {
    releaseSandboxToolchainResidentTransition();
  }
}

async function restoreActivation(state: ToolchainActivationState): Promise<void> {
  activationCwd = state.cwd;
  activationBindings = state.bindings;
  if (runtimeBackend === null) throw new Error('toolchain VFS backend is not ready');
  const { prepareSavedToolchain } = await import('./no-coi-toolchain-install.ts');
  if (runtimeBackend === 'memory' || runtimeBackend !== state.vfsBackend) {
    const fs = syncMirror();
    const suffix = `/node_modules/${INSTALL_STAMP_BASENAME}`;
    const claims = state.files.filter((file) => file.path.endsWith(suffix));
    // A retained host snapshot owns these claims. Revoke old disk markers
    // before replacement; publish them only after all ordinary bytes persist.
    for (const file of claims)
      installContext.claims.remove(file.path.slice(0, -suffix.length) || '/');
    await flushMirror();
    for (const path of state.directories ?? []) fs.mkdirSync(path, { recursive: true });
    for (const file of state.files) {
      if (file.path.endsWith(suffix)) continue;
      fs.mkdirSync(dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.data);
    }
    await flushMirror();
    await installContext.fs.fence();
    for (const file of claims) {
      installContext.claims.write(file.path.slice(0, -suffix.length) || '/', file.data, {
        mkdirTree: true,
      });
    }
    await flushMirror();
  }
  // TODO(backlog: distribution/no-coi-activation-bindings-shrink): state.bindings is unused here.
  await prepareSavedToolchain(state.cwd);
}

async function dispatch(request: ToolchainRequest): Promise<ToolchainResultValue | undefined> {
  if (
    residentPort !== null &&
    (request.op === 'install' ||
      request.op === 'open' ||
      request.op === 'apply-snapshot' ||
      request.op === 'run-bin' ||
      request.op === 'command' ||
      request.op === 'project-fs')
  ) {
    throw new NotImplementedError(
      'sandbox.toolchain.resident-concurrency',
      'install/open/runBin while a resident bin is active is not supported',
    );
  }
  if (request.op === 'project-fs') {
    const project = validateProjectOptions(request.input.project);
    const release = projectContext.activate(project);
    if (!claimSandboxToolchainResidentTransition()) {
      release();
      throw new Error('toolchain realm is already owned');
    }
    try {
      const fsResult = await handleWorkerFsRequest(request.input.request, {
        fs: projectContext.fs,
        invalidate: invalidateRuntimeWorkerModules,
        flush: () => installContext.fs.flush(),
      });
      return { fsResult };
    } finally {
      release();
      releaseSandboxToolchainResidentTransition();
    }
  }
  if (request.op === 'command') {
    const input = validateCommandInput(request.input);
    const release = projectContext.activate(input.project);
    if (!claimSandboxToolchainResidentTransition()) {
      release();
      throw new Error('toolchain realm is already owned');
    }
    const controller = new AbortController();
    activeCommand = { id: request.id, controller };
    self.postMessage({ type: 'toolchain-command-started', id: request.id });
    let command: ToolchainCommandResult;
    let unsettled = false;
    try {
      const { runNoCoiProjectCommand } = await import('./no-coi-project-command.ts');
      command = await runNoCoiProjectCommand(input, controller.signal, {
        fs: projectContext.fs,
        onOutput(chunk, stream) {
          self.postMessage({ type: 'toolchain-command-output', id: request.id, chunk, stream });
        },
        flush: () => checkedRuntimeFsFlush(() => installContext.fs.flush()),
        effects: projectContext.effects,
      });
      if (command.requiresTermination) {
        unsettled = true;
        mustTerminate = true;
        return { command };
      }
      invalidateRuntimeWorkerModules();
      const state =
        command.effects.persistence === 'failed'
          ? undefined
          : activationSnapshot(activationCwd ?? input.project.root, activationBindings);
      return { command, ...(state === undefined ? {} : { activationState: state }) };
    } finally {
      if (!unsettled) {
        activeCommand = null;
        release();
        releaseSandboxToolchainResidentTransition();
      }
    }
  }
  if (request.op === 'apply-snapshot')
    return { activationState: await applySnapshot(request.input) };
  if (request.op === 'open') return { activationState: await openInstallation(request.input) };
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
    readonly effects?: unknown;
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
let mustTerminate = false;
self.addEventListener('message', (event: MessageEvent<{ type?: unknown; request?: unknown }>) => {
  if (event.data?.type === 'toolchain-command-stop') {
    if (activeCommand !== null && activeCommand.id === (event.data as { id?: unknown }).id)
      activeCommand.controller.abort();
    return;
  }
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
        if (request.op === 'start-bin' && residentPort === null) {
          closeToolchainWorker(serializedError(error));
        } else post({ id: request.id, ok: false, error: serializedError(error) });
      },
    )
    .finally(() => {
      if (!mustTerminate) busy = false;
    });
});

void import('@riftydev/runtime-js/worker')
  .then(({ runtimeWorkerStorage }) => runtimeWorkerStorage)
  .then(({ backend: vfsBackend, reason }) => {
    runtimeBackend = vfsBackend;
    installFetchKeepalive();
    self.postMessage({
      type: 'toolchain-ready',
      protocol: SANDBOX_TOOLCHAIN_PROTOCOL,
      vfsBackend,
      ...(reason === undefined ? {} : { vfsReason: reason }),
    });
  });

function installToolchainCloseSignal() {
  const nativeClose = self.close.bind(self);
  let signalled = false;
  const close = (error?: SerializedRuntimeError): void => {
    if (!signalled) {
      signalled = true;
      self.postMessage({
        type: 'toolchain-terminal',
        reason: 'closed',
        ...(error === undefined ? {} : { error }),
      });
    }
    nativeClose();
  };
  Object.defineProperty(self, 'close', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: () => close(),
  });
  return close;
}
