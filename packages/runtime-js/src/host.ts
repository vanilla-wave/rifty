import { type RuntimeFs, createRuntimeFs, deserializeRuntimeError } from './host-fs.ts';
export type { RuntimeFs } from './host-fs.ts';
import { NotImplementedError } from '@riftydev/io';
import { applyRecoveryFsOperation } from './host-fs-recovery.ts';
import {
  projectFsOperation,
  validateCommandInput,
  validateProjectOptions,
} from './host-project-inputs.ts';
import {
  exactInput,
  validateActivationState,
  validateInstallRequest,
  validateOpenRequest,
  validateRunBinRequest,
  validateSnapshotRequest,
  validateStartBinRequest,
} from './internal/toolchain-input.ts';
import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  type RuntimeStartupOptions,
  captureRuntimeStartupOptions,
  runtimeWorkerName,
} from './internal/worker-startup-options.ts';
import type {
  EvalResult,
  FsRequest,
  FsResult,
  SerializedRuntimeError,
  TelemetrySnapshot,
  ToolchainActivationState,
  ToolchainApplySnapshotRequest,
  ToolchainCommandInput,
  ToolchainCommandResult,
  ToolchainHostMessage,
  ToolchainInstallRequest,
  ToolchainOpenRequest,
  ToolchainProjectOptions,
  ToolchainRequest,
  ToolchainResult,
  ToolchainRunBinRequest,
  ToolchainStartBinRequest,
  ToolchainWorkerMessage,
  VmEngineName,
} from './protocol.ts';
import { SANDBOX_TOOLCHAIN_PROTOCOL as TOOLCHAIN_PROTOCOL } from './protocol.ts';

export interface RuntimeOptions {
  /** URL of the worker entry module. */
  readonly workerUrl: string;
  /** Optional pre-populated fixture for the in-Worker VFS (path → source). */
  readonly fixture?: Readonly<Record<string, string>>;
  /**
   * Programmatic vm override, delivered through the native Worker name before
   * boot/preload (ADR-0383). Absent preserves worker env/global/default selection.
   */
  readonly vmEngine?: VmEngineName;
}

export type ToolchainRuntimeOptions = RuntimeOptions & RuntimeStartupOptions;

export type RuntimeEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'stdout'; readonly chunk: string }
  | { readonly type: 'stderr'; readonly chunk: string }
  | { readonly type: 'result'; readonly result: EvalResult }
  | { readonly type: 'exit'; readonly reason: 'reset' | 'error' }
  /** Divergence / NotImplemented telemetry snapshot from the worker (T15) — the
   * playground divergence panel (T16) subscribes via {@link RuntimeController.on}. */
  | { readonly type: 'diagnostic'; readonly payload: TelemetrySnapshot };

/** ADR-0019: seed Worker cwd before eval; omission preserves its current
 * process.cwd() (initially `/workspace`). */
export interface EvalOptions {
  readonly cwd?: string;
}

export interface RuntimeController {
  /** Console-oriented evaluation: prints the expression value; success returns value undefined. */
  eval(code: string, options?: EvalOptions): Promise<EvalResult>;
  /**
   * Worker-realm filesystem RPC (ADR-0131) — reads/writes the authoritative
   * VFS the guest's `node:fs` sees. See {@link RuntimeFs} for path semantics.
   */
  readonly fs: RuntimeFs;
  /** Send raw terminal stdin to the runtime Worker's `process.stdin`. */
  writeStdin(data: string | Uint8Array): void;
  /** Terminate and respawn the worker. */
  reset(): Promise<void>;
  dispose(): void;
  on(handler: (event: RuntimeEvent) => void): () => void;
  /** Write a file into the in-Worker VFS. Used for editor↔runtime sync (M10). */
  writeFile(path: string, content: string): void;
  readonly isReady: () => boolean;
}

export interface RuntimeToolchain {
  install(input: ToolchainInstallRequest): Promise<void>;
  open(input: ToolchainOpenRequest): Promise<void>;
  applySnapshot(input: ToolchainApplySnapshotRequest): Promise<void>;
  runBin(input: ToolchainRunBinRequest): Promise<{ readonly exitCode: number }>;
  startBin(input: ToolchainStartBinRequest): Promise<{ readonly port: number }>;
}

export interface RuntimeCommandObserver {
  started(): void;
  output(chunk: string, stream: 'stdout' | 'stderr'): void;
}

export interface RuntimeCommandCall {
  readonly result: Promise<ToolchainCommandResult>;
  stop(): void;
}

export interface ToolchainRuntimeController extends RuntimeController {
  projectFs(options: ToolchainProjectOptions): RuntimeFs;
  command(input: ToolchainCommandInput, observer: RuntimeCommandObserver): RuntimeCommandCall;
  readonly toolchain: RuntimeToolchain;
  readonly toolchainReady: Promise<'opfs' | 'memory'>;
  readonly toolchainVfs: { readonly backend: 'opfs' | 'memory'; readonly reason?: string };
  snapshotToolchainState(): ToolchainActivationState | null;
  snapshotResidentRequest(): ToolchainStartBinRequest | null;
  restoreToolchainState(state: ToolchainActivationState): Promise<void>;
}

interface PendingEval {
  resolve(result: EvalResult): void;
  reject(err: unknown): void;
}

type PendingRequest =
  | {
      readonly kind: 'fs';
      resolve(result: FsResult): void;
      reject(err: unknown): void;
    }
  | {
      readonly kind: 'toolchain';
      readonly observer?: RuntimeCommandObserver;
      resolve(result: ToolchainResult): void;
      reject(err: unknown): void;
    };

interface RuntimeError extends Error {
  code?: string;
  path?: string;
  feature?: string;
}

/** Host-side controller for the JS runtime Worker. Hides the message protocol. */
export function spawnRuntime(opts: RuntimeOptions): RuntimeController {
  return createRuntimeController(opts, false);
}

/** Runtime controller with the sandbox toolchain handshake/control plane. */
export function spawnToolchainRuntime(opts: ToolchainRuntimeOptions): ToolchainRuntimeController {
  return createRuntimeController(opts, true);
}

function createRuntimeController(opts: RuntimeOptions, toolchainMode: false): RuntimeController;
function createRuntimeController(
  opts: ToolchainRuntimeOptions,
  toolchainMode: true,
): ToolchainRuntimeController;
function createRuntimeController(
  opts: ToolchainRuntimeOptions,
  toolchainMode: boolean,
): RuntimeController | ToolchainRuntimeController {
  const startup = captureRuntimeStartupOptions(opts);
  const startupTimeoutMs = startup.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const handlers = new Set<(event: RuntimeEvent) => void>();
  let worker: Worker | null = null;
  let nextId = 1;
  let ready = false;
  const pending = new Map<number, PendingEval>();
  const pendingRequests = new Map<number, PendingRequest>();
  let toolchainBackend: 'opfs' | 'memory' | null = null;
  let toolchainReason: string | undefined;
  let toolchainReadySettled = false;
  let resolveToolchainReady: ((backend: 'opfs' | 'memory') => void) | undefined;
  let rejectToolchainReady: ((error: unknown) => void) | undefined;
  const toolchainReady = toolchainMode
    ? new Promise<'opfs' | 'memory'>((resolve, reject) => {
        resolveToolchainReady = resolve;
        rejectToolchainReady = reject;
      })
    : null;
  let toolchainHandshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let activationState: ToolchainActivationState | null = null;
  let residentRequest: ToolchainStartBinRequest | null = null;

  function toolchainHandshakeError(message: string): NotImplementedError {
    return new NotImplementedError('sandbox.toolchain.worker', message);
  }

  function settleToolchainReady(): void {
    if (!toolchainMode || toolchainReadySettled || !ready || toolchainBackend === null) return;
    toolchainReadySettled = true;
    if (toolchainHandshakeTimer !== undefined) clearTimeout(toolchainHandshakeTimer);
    resolveToolchainReady?.(toolchainBackend);
  }

  function rejectToolchainHandshake(error: unknown): void {
    if (!toolchainMode || toolchainReadySettled) return;
    toolchainReadySettled = true;
    if (toolchainHandshakeTimer !== undefined) clearTimeout(toolchainHandshakeTimer);
    rejectToolchainReady?.(error);
  }

  function terminateToolchainPeer(error: RuntimeError): void {
    rejectPendingCalls(error);
    rejectToolchainHandshake(error);
    ready = false;
    if (worker !== null) {
      worker.terminate();
      worker = null;
    }
  }

  function emit(event: RuntimeEvent): void {
    for (const h of handlers) {
      try {
        h(event);
      } catch (err) {
        console.error('runtime listener threw', err);
      }
    }
  }

  function send(message: ToolchainHostMessage): void {
    if (!worker) throw new Error('Runtime is not running');
    worker.postMessage(message);
  }

  function workerTerminatedError(message: string): RuntimeError {
    const err = new Error(message) as RuntimeError;
    err.name = 'WorkerTerminated';
    Object.assign(err, { effects: { applied: 'unknown', persistence: 'unknown' } });
    return err;
  }

  function deserializeError(error: SerializedRuntimeError): RuntimeError {
    return deserializeRuntimeError(error);
  }

  function rejectPendingRequests(err: unknown): void {
    for (const p of pendingRequests.values()) {
      p.reject(err);
    }
    pendingRequests.clear();
  }

  function rejectPendingCalls(err: unknown): void {
    for (const call of pending.values()) {
      call.reject(err);
    }
    pending.clear();
    rejectPendingRequests(err);
  }

  function requestFs(request: FsRequest): Promise<FsResult> {
    // Typed like the crash/reset rejections so consumers can branch on
    // err.name/err.code uniformly (the bare send() throw is name 'Error').
    if (!worker) {
      const err = workerTerminatedError('Runtime is not running');
      err.code = 'RUNTIME_NOT_RUNNING';
      return Promise.reject(err);
    }
    const promise = new Promise<FsResult>((resolve, reject) => {
      pendingRequests.set(request.id, { kind: 'fs', resolve, reject });
    });
    try {
      send({ type: 'fs', request });
    } catch (err) {
      pendingRequests.delete(request.id);
      return Promise.reject(err);
    }
    return promise;
  }

  function requestToolchain(
    request: ToolchainRequest,
    observer?: RuntimeCommandObserver,
  ): Promise<ToolchainResult> {
    if (!worker) {
      const err = workerTerminatedError('Runtime is not running');
      err.code = 'RUNTIME_NOT_RUNNING';
      return Promise.reject(err);
    }
    const promise = new Promise<ToolchainResult>((resolve, reject) => {
      pendingRequests.set(request.id, { kind: 'toolchain', resolve, reject, observer });
    });
    try {
      send({ type: 'toolchain', request });
    } catch (err) {
      pendingRequests.delete(request.id);
      return Promise.reject(err);
    }
    return promise;
  }

  const fs: RuntimeFs = createRuntimeFs(async (operation) => {
    const result = await requestFs({ ...operation, id: nextId++ });
    if (result.ok) activationState = applyRecoveryFsOperation(activationState, operation);
    return result;
  });

  function start(): void {
    const name = runtimeWorkerName(startup);
    worker = new Worker(opts.workerUrl, {
      type: 'module',
      ...(name === undefined ? {} : { name }),
    });
    const peer = worker;
    peer.addEventListener('message', (event: MessageEvent<ToolchainWorkerMessage>) => {
      if (worker !== peer) return;
      const msg = event.data;
      switch (msg.type) {
        case 'ready':
          ready = true;
          if (opts.fixture) send({ type: 'load-fixture', files: opts.fixture });
          emit({ type: 'ready' });
          settleToolchainReady();
          break;
        case 'toolchain-ready': {
          if (!toolchainMode) break;
          const decoded = decodeToolchainReady(msg);
          if (decoded === null) {
            terminateToolchainPeer(
              toolchainHandshakeError('toolchain Worker sent an invalid readiness frame'),
            );
            break;
          }
          toolchainBackend = decoded;
          toolchainReason = msg.vfsReason;
          settleToolchainReady();
          break;
        }
        case 'toolchain-terminal': {
          if (!toolchainMode) break;
          terminateToolchainPeer(
            msg.error === undefined
              ? workerTerminatedError('Toolchain Worker closed')
              : deserializeError(msg.error),
          );
          emit({ type: 'exit', reason: 'error' });
          break;
        }
        case 'stdout':
          emit({ type: 'stdout', chunk: msg.chunk });
          break;
        case 'stderr':
          emit({ type: 'stderr', chunk: msg.chunk });
          break;
        case 'result': {
          const p = pending.get(msg.result.id);
          if (p) {
            pending.delete(msg.result.id);
            p.resolve(msg.result);
          }
          emit({ type: 'result', result: msg.result });
          break;
        }
        case 'fs-result': {
          const p = pendingRequests.get(msg.result.id);
          if (p?.kind === 'fs') {
            pendingRequests.delete(msg.result.id);
            p.resolve(msg.result);
          }
          break;
        }
        case 'toolchain-command-started': {
          const entry = pendingRequests.get(msg.id);
          if (entry?.kind === 'toolchain') entry.observer?.started();
          break;
        }
        case 'toolchain-command-output': {
          const entry = pendingRequests.get(msg.id);
          if (entry?.kind === 'toolchain') entry.observer?.output(msg.chunk, msg.stream);
          break;
        }
        case 'toolchain-result': {
          const p = pendingRequests.get(msg.result.id);
          if (p?.kind === 'toolchain') {
            const needsTermination =
              msg.result.ok &&
              msg.result.value !== undefined &&
              'command' in msg.result.value &&
              msg.result.value.command.requiresTermination;
            if (!needsTermination) pendingRequests.delete(msg.result.id);
            p.resolve(msg.result);
          }
          break;
        }
        case 'diagnostic':
          emit({ type: 'diagnostic', payload: msg.payload });
          break;
        case 'pong':
          break;
      }
    });
    peer.addEventListener('error', (event: ErrorEvent) => {
      if (worker !== peer) return;
      // This controller owns the crash; do not rethrow it into the creator.
      event.preventDefault();
      // Reject every in-flight eval so callers see the failure instead of
      // hanging forever. Match Node's pattern: synthesise an Error with a
      // stable `code` so callers can branch on it.
      const crash = Object.assign(new Error(`Worker crashed: ${event.message}`), {
        code: 'WORKER_CRASHED',
      });
      rejectPendingCalls(crash);
      rejectToolchainHandshake(
        toolchainHandshakeError(`toolchain Worker crashed during handshake: ${event.message}`),
      );
      emit({
        type: 'stderr',
        chunk: `[worker error] ${event.message}\n`,
      });
      emit({ type: 'exit', reason: 'error' });
      ready = false;
      if (worker) {
        worker.terminate();
        worker = null;
      }
    });
  }

  if (toolchainMode) {
    toolchainHandshakeTimer = setTimeout(() => {
      terminateToolchainPeer(
        toolchainHandshakeError(
          `toolchain Worker did not complete ${TOOLCHAIN_PROTOCOL} handshake within ${startupTimeoutMs}ms`,
        ),
      );
    }, startupTimeoutMs);
  }
  try {
    start();
  } catch (error) {
    if (toolchainHandshakeTimer !== undefined) clearTimeout(toolchainHandshakeTimer);
    throw error;
  }

  const controller: RuntimeController = {
    eval(code, options) {
      const id = nextId++;
      const promise = new Promise<EvalResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      const request = options?.cwd !== undefined ? { id, code, cwd: options.cwd } : { id, code };
      send({ type: 'eval', request });
      return promise;
    },
    fs,
    writeStdin(data) {
      send({ type: 'stdin', data });
    },
    async reset() {
      if (worker) {
        worker.terminate();
        for (const p of pending.values()) {
          p.resolve({
            id: -1,
            ok: false,
            error: { name: 'WorkerTerminated', message: 'Worker was reset' },
          });
        }
        pending.clear();
        rejectPendingRequests(workerTerminatedError('Worker was reset'));
        worker = null;
        ready = false;
        emit({ type: 'exit', reason: 'reset' });
      }
      start();
    },
    dispose() {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      const terminated = workerTerminatedError('Worker was disposed');
      if (toolchainMode) rejectPendingCalls(terminated);
      else {
        rejectPendingRequests(terminated);
        pending.clear();
      }
      rejectToolchainHandshake(terminated);
      handlers.clear();
      ready = false;
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    writeFile(path, content) {
      send({ type: 'load-fixture', files: { [path]: content } });
    },
    isReady: () => ready,
  };
  if (!toolchainMode || toolchainReady === null) return controller;

  async function activateToolchain(
    op: 'install' | 'open' | 'apply-snapshot',
    input: ToolchainInstallRequest | ToolchainOpenRequest | ToolchainApplySnapshotRequest,
  ): Promise<void> {
    const id = nextId++;
    const request: ToolchainRequest =
      op === 'apply-snapshot'
        ? { id, op, input: validateSnapshotRequest(input as ToolchainApplySnapshotRequest) }
        : op === 'open'
          ? { id, op, input: validateOpenRequest(input) }
          : {
              id,
              op,
              input: validateInstallRequest(input as ToolchainInstallRequest, 'toolchain.install'),
            };
    await toolchainReady;
    const result = await requestToolchain(request);
    if (!result.ok) throw deserializeError(result.error);
    const value = exactInput(result.value, ['activationState'], `toolchain ${op} response`);
    activationState = validateActivationState(
      value.activationState,
      `toolchain ${op} activation state`,
    );
  }
  const toolchain: RuntimeToolchain = {
    install: (input) => activateToolchain('install', input),
    open: (input) => activateToolchain('open', input),
    applySnapshot: (input) => activateToolchain('apply-snapshot', input),
    async runBin(input) {
      const validated = validateRunBinRequest(input);
      await toolchainReady;
      const result = await requestToolchain({ id: nextId++, op: 'run-bin', input: validated });
      if (!result.ok) throw deserializeError(result.error);
      const value = exactInput(result.value, ['exitCode'], 'toolchain run-bin response');
      if (typeof value.exitCode !== 'number') {
        throw new Error('Invalid toolchain run-bin response');
      }
      return { exitCode: value.exitCode };
    },
    async startBin(input) {
      const validated = validateStartBinRequest(input);
      await toolchainReady;
      const result = await requestToolchain({ id: nextId++, op: 'start-bin', input: validated });
      if (!result.ok) throw deserializeError(result.error);
      const value = exactInput(result.value, ['port'], 'toolchain start-bin response');
      if (value.port !== validated.port) {
        throw new Error('Invalid toolchain start-bin response');
      }
      residentRequest = validated;
      return { port: validated.port };
    },
  };
  return {
    ...controller,
    async reset() {
      throw new NotImplementedError(
        'sandbox.toolchain.restart',
        'toolchain Worker restart is not available in build-only mode',
      );
    },
    toolchain,
    toolchainReady,
    projectFs(options) {
      const project = validateProjectOptions(options);
      return createRuntimeFs(async (operation) => {
        const scoped = projectFsOperation(operation, project.root);
        const id = nextId++;
        await toolchainReady;
        const result = await requestToolchain({
          id,
          op: 'project-fs',
          input: { project, request: { ...scoped, id } },
        });
        if (!result.ok) throw deserializeError(result.error);
        if (result.value === undefined || !('fsResult' in result.value))
          throw new Error('Invalid project fs response');
        if (result.value.fsResult.ok)
          activationState = applyRecoveryFsOperation(activationState, scoped);
        return result.value.fsResult;
      });
    },
    command(input, observer) {
      const validated = validateCommandInput(input);
      const id = nextId++;
      const result = requestToolchain({ id, op: 'command', input: validated }, observer).then(
        (reply) => {
          if (!reply.ok) throw deserializeError(reply.error);
          if (reply.value === undefined || !('command' in reply.value))
            throw new Error('Invalid command response');
          if (reply.value.activationState !== undefined)
            activationState = validateActivationState(
              reply.value.activationState,
              'command recovery state',
            );
          return reply.value.command;
        },
      );
      return {
        result,
        stop() {
          send({ type: 'toolchain-command-stop', id });
        },
      };
    },
    get toolchainVfs() {
      if (toolchainBackend === null) throw new Error('Toolchain storage is not ready');
      return {
        backend: toolchainBackend,
        ...(toolchainReason === undefined ? {} : { reason: toolchainReason }),
      };
    },
    snapshotToolchainState() {
      return activationState === null
        ? null
        : Object.freeze({
            ...activationState,
            files: Object.freeze(
              activationState.files.map((file) =>
                Object.freeze({ path: file.path, data: new Uint8Array(file.data) }),
              ),
            ),
          });
    },
    snapshotResidentRequest() {
      return residentRequest;
    },
    async restoreToolchainState(state) {
      const validated = validateActivationState(state, 'toolchain restore activation state');
      const backend = await toolchainReady;
      const input =
        backend === 'opfs' && validated.vfsBackend === 'opfs'
          ? { ...validated, files: [] }
          : validated;
      const result = await requestToolchain({ id: nextId++, op: 'restore', input });
      if (!result.ok) throw deserializeError(result.error);
      activationState = Object.freeze({ ...validated, vfsBackend: backend });
    },
  };
}

function decodeToolchainReady(value: unknown): 'opfs' | 'memory' | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).toSorted();
  if (
    (keys.length !== 3 && keys.length !== 4) ||
    keys[0] !== 'protocol' ||
    keys[1] !== 'type' ||
    keys[2] !== 'vfsBackend' ||
    (keys.length === 4 && keys[3] !== 'vfsReason')
  ) {
    return null;
  }
  if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) return null;
  const frame = value as Record<string, unknown>;
  if (
    'vfsReason' in frame &&
    (frame.vfsBackend !== 'memory' || typeof frame.vfsReason !== 'string')
  )
    return null;
  if (frame.type !== 'toolchain-ready' || frame.protocol !== TOOLCHAIN_PROTOCOL) return null;
  return frame.vfsBackend === 'opfs' || frame.vfsBackend === 'memory' ? frame.vfsBackend : null;
}
