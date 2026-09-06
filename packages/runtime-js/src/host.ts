import { NotImplementedError } from '@riftydev/io';
import { normalizePath } from '@riftydev/vfs';
import type {
  EvalResult,
  FsReadEncoding,
  FsRequest,
  FsResult,
  SerializedRuntimeError,
  TelemetrySnapshot,
  ToolchainActivationState,
  ToolchainHostMessage,
  ToolchainInstallRequest,
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
   * Programmatic `node:vm` sandbox engine override (ADR-0142). When set, the host
   * sends a `vm-config` message on worker readiness so the worker applies it via
   * `setVmEngineOverride`. When absent, behavior is unchanged — the worker
   * resolves the engine itself (`resolveVmEngineName`: env-config / default).
   */
  readonly vmEngine?: VmEngineName;
}

export type RuntimeEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'stdout'; readonly chunk: string }
  | { readonly type: 'stderr'; readonly chunk: string }
  | { readonly type: 'result'; readonly result: EvalResult }
  | { readonly type: 'exit'; readonly reason: 'reset' | 'error' }
  /** Divergence / NotImplemented telemetry snapshot from the worker (T15) — the
   * playground divergence panel (T16) subscribes via {@link RuntimeController.on}. */
  | { readonly type: 'diagnostic'; readonly payload: TelemetrySnapshot };

/**
 * Per-call options for {@link RuntimeController.eval}. Optional today —
 * existing callers that pass a bare `code` string keep working.
 *
 * ADR-0019: `cwd` lets the host seed the per-Worker cwd cell before the
 * eval runs. When omitted the worker keeps whatever `process.cwd()`
 * already pointed to (default `/workspace`).
 */
export interface EvalOptions {
  readonly cwd?: string;
}

export interface RuntimeController {
  /** Send an eval request; resolves with the result message. */
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
  runBin(input: ToolchainRunBinRequest): Promise<{ readonly exitCode: number }>;
  startBin(input: ToolchainStartBinRequest): Promise<{ readonly port: number }>;
}

export interface ToolchainRuntimeController extends RuntimeController {
  readonly toolchain: RuntimeToolchain;
  readonly toolchainReady: Promise<'opfs' | 'memory'>;
  snapshotToolchainState(): ToolchainActivationState | null;
  snapshotResidentRequest(): ToolchainStartBinRequest | null;
  restoreToolchainState(state: ToolchainActivationState): Promise<void>;
}

/**
 * Host-side filesystem surface backed by the runtime Worker's VFS (ADR-0131).
 *
 * Path semantics: paths resolve from the VFS ROOT (`/`), NOT the guest's
 * `process.cwd()` (default `/workspace`) — `writeFile('a.txt', …)` lands at
 * `/a.txt` while guest `fs.writeFileSync('a.txt', …)` lands at
 * `/workspace/a.txt`. Pass absolute paths to avoid the divergence.
 *
 * `writeFile` resolves only after the worker created parent dirs, wrote the
 * bytes, invalidated the module loader, and awaited the active mirror's flush.
 * Failures reject with the serialized VFS error (`name`/`message`/`code`/
 * `path`); calls against a crashed/reset/disposed worker reject with
 * `name: 'WorkerTerminated'` or `code: 'WORKER_CRASHED'`/`'RUNTIME_NOT_RUNNING'`.
 */
export interface RuntimeFs {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: FsReadEncoding): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
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
      resolve(result: ToolchainResult): void;
      reject(err: unknown): void;
    };

interface RuntimeError extends Error {
  code?: string;
  path?: string;
  feature?: string;
}

const TOOLCHAIN_HANDSHAKE_TIMEOUT_MS = 10_000;

/** Host-side controller for the JS runtime Worker. Hides the message protocol. */
export function spawnRuntime(opts: RuntimeOptions): RuntimeController {
  return createRuntimeController(opts, false);
}

/** Runtime controller with the sandbox toolchain v2 handshake/control plane. */
export function spawnToolchainRuntime(opts: RuntimeOptions): ToolchainRuntimeController {
  return createRuntimeController(opts, true);
}

function createRuntimeController(opts: RuntimeOptions, toolchainMode: false): RuntimeController;
function createRuntimeController(
  opts: RuntimeOptions,
  toolchainMode: true,
): ToolchainRuntimeController;
function createRuntimeController(
  opts: RuntimeOptions,
  toolchainMode: boolean,
): RuntimeController | ToolchainRuntimeController {
  const handlers = new Set<(event: RuntimeEvent) => void>();
  let worker: Worker | null = null;
  let nextId = 1;
  let ready = false;
  const pending = new Map<number, PendingEval>();
  const pendingRequests = new Map<number, PendingRequest>();
  let toolchainBackend: 'opfs' | 'memory' | null = null;
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
    return err;
  }

  function deserializeError(error: SerializedRuntimeError): RuntimeError {
    const err = new Error(error.message) as RuntimeError;
    err.name = error.name;
    if (error.stack !== undefined) err.stack = error.stack;
    if (error.code !== undefined) err.code = error.code;
    if (error.path !== undefined) err.path = error.path;
    if (error.feature !== undefined) err.feature = error.feature;
    return err;
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

  function requestToolchain(request: ToolchainRequest): Promise<ToolchainResult> {
    if (!worker) {
      const err = workerTerminatedError('Runtime is not running');
      err.code = 'RUNTIME_NOT_RUNNING';
      return Promise.reject(err);
    }
    const promise = new Promise<ToolchainResult>((resolve, reject) => {
      pendingRequests.set(request.id, { kind: 'toolchain', resolve, reject });
    });
    try {
      send({ type: 'toolchain', request });
    } catch (err) {
      pendingRequests.delete(request.id);
      return Promise.reject(err);
    }
    return promise;
  }

  function readFile(path: string): Promise<Uint8Array>;
  function readFile(path: string, encoding: FsReadEncoding): Promise<string>;
  async function readFile(path: string, encoding?: FsReadEncoding): Promise<Uint8Array | string> {
    const id = nextId++;
    const result = await requestFs(
      encoding === undefined
        ? { id, op: 'readFile', path }
        : { id, op: 'readFile', path, encoding },
    );
    if (!result.ok) throw deserializeError(result.error);
    if (encoding === undefined) {
      if (result.value instanceof Uint8Array) return result.value;
      throw new Error('Invalid fs readFile byte response');
    }
    if (typeof result.value === 'string') return result.value;
    throw new Error('Invalid fs readFile text response');
  }

  async function writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const recoveryData =
      typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const result = await requestFs({ id: nextId++, op: 'writeFile', path, data });
    if (!result.ok) throw deserializeError(result.error);
    if (activationState !== null) {
      const normalized = normalizePath(path);
      const absolute = normalized.startsWith('/') ? normalized : normalizePath(`/${normalized}`);
      const files = activationState.files.filter((file) => file.path !== absolute);
      files.push(Object.freeze({ path: absolute, data: recoveryData }));
      files.sort((left, right) => left.path.localeCompare(right.path));
      activationState = Object.freeze({ ...activationState, files: Object.freeze(files) });
    }
  }

  function start(): void {
    worker = new Worker(opts.workerUrl, { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<ToolchainWorkerMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ready':
          ready = true;
          // Apply the programmatic vm-engine override (ADR-0142) before anything
          // runs, so the first eval already sees the chosen engine.
          if (opts.vmEngine) send({ type: 'vm-config', engine: opts.vmEngine });
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
          settleToolchainReady();
          break;
        }
        case 'toolchain-terminal': {
          if (!toolchainMode) break;
          terminateToolchainPeer(workerTerminatedError('Toolchain Worker closed'));
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
        case 'toolchain-result': {
          const p = pendingRequests.get(msg.result.id);
          if (p?.kind === 'toolchain') {
            pendingRequests.delete(msg.result.id);
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
    worker.addEventListener('error', (event: ErrorEvent) => {
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
      rejectToolchainHandshake(
        toolchainHandshakeError(
          `toolchain Worker did not complete ${TOOLCHAIN_PROTOCOL} handshake within ${TOOLCHAIN_HANDSHAKE_TIMEOUT_MS}ms`,
        ),
      );
    }, TOOLCHAIN_HANDSHAKE_TIMEOUT_MS);
  }
  start();

  const fs: RuntimeFs = { readFile, writeFile };

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

  const toolchain: RuntimeToolchain = {
    async install(input) {
      const validated = validateInstallRequest(input);
      await toolchainReady;
      const result = await requestToolchain({ id: nextId++, op: 'install', input: validated });
      if (!result.ok) throw deserializeError(result.error);
      const value = exactInput(result.value, ['activationState'], 'toolchain install response');
      activationState = validateActivationState(
        value.activationState,
        'toolchain install activation state',
      );
    },
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
    keys.length !== 3 ||
    keys[0] !== 'protocol' ||
    keys[1] !== 'type' ||
    keys[2] !== 'vfsBackend'
  ) {
    return null;
  }
  if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) return null;
  const frame = value as Record<string, unknown>;
  if (frame.type !== 'toolchain-ready' || frame.protocol !== TOOLCHAIN_PROTOCOL) return null;
  return frame.vfsBackend === 'opfs' || frame.vfsBackend === 'memory' ? frame.vfsBackend : null;
}

function exactInput(
  input: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${label} has symbol fields`);
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor)) throw new TypeError(`${label} has accessor fields`);
  }
  const actual = Object.keys(descriptors).toSorted();
  const expected = [...fields].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has extra or missing fields`);
  }
  return Object.freeze(
    Object.fromEntries(
      actual.map((field) => {
        const descriptor = descriptors[field];
        if (descriptor === undefined || !('value' in descriptor)) {
          throw new TypeError(`${label} has accessor fields`);
        }
        return [field, descriptor.value] as const;
      }),
    ),
  );
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || !value.startsWith('/')) {
    throw new TypeError(`${label} must be an absolute VFS path`);
  }
  const normalized = normalizePath(value);
  if (normalized !== value || value === '/') {
    throw new TypeError(`${label} must be a normalized non-root VFS path`);
  }
  return value;
}

function validateInstallRequest(input: ToolchainInstallRequest): ToolchainInstallRequest {
  const record = exactInput(input, ['cwd', 'registryUrl'], 'toolchain.install input');
  const cwd = absolutePath(record.cwd, 'toolchain.install cwd');
  if (typeof record.registryUrl !== 'string' || record.registryUrl.length === 0) {
    throw new TypeError('toolchain.install registryUrl must be a non-empty string');
  }
  return Object.freeze({ cwd, registryUrl: record.registryUrl });
}

function validateBinInput(
  input: unknown,
  fields: readonly string[],
  label: string,
): {
  readonly request: ToolchainRunBinRequest;
  readonly record: Readonly<Record<string, unknown>>;
} {
  const record = exactInput(input, fields, `${label} input`);
  const cwd = absolutePath(record.cwd, `${label} cwd`);
  const binPath = absolutePath(record.binPath, `${label} binPath`);
  const binPrefix = `${cwd}/node_modules/.bin/`;
  if (!binPath.startsWith(binPrefix) || binPath.slice(binPrefix.length).includes('/')) {
    throw new TypeError(`${label} binPath must name an installed node_modules/.bin entry`);
  }
  if (!Array.isArray(record.args)) {
    throw new TypeError(`${label} args must be a dense string array`);
  }
  const args = record.args;
  const descriptors = Object.getOwnPropertyDescriptors(args);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${label} args must be a dense string array`);
  }
  const length = (descriptors as unknown as Record<PropertyKey, PropertyDescriptor>).length;
  const indexKeys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    indexKeys.length !== length.value ||
    indexKeys.some((key, index) => key !== String(index)) ||
    indexKeys.some((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string'
      );
    })
  ) {
    throw new TypeError(`${label} args must be a dense string array`);
  }
  const copiedArgs = indexKeys.map((key) => {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(`${label} args must be a dense string array`);
    }
    return descriptor.value;
  });
  return {
    record,
    request: Object.freeze({ cwd, binPath, args: Object.freeze(copiedArgs) }),
  };
}

function validateRunBinRequest(input: ToolchainRunBinRequest): ToolchainRunBinRequest {
  return validateBinInput(input, ['args', 'binPath', 'cwd'], 'toolchain.runBin').request;
}

function validateStartBinRequest(input: ToolchainStartBinRequest): ToolchainStartBinRequest {
  const validated = validateBinInput(
    input,
    ['args', 'binPath', 'cwd', 'port'],
    'toolchain.startBin',
  );
  const port = validated.record.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('toolchain.startBin port must be an integer from 1 through 65535');
  }
  return Object.freeze({ ...validated.request, port });
}

function validateActivationState(input: unknown, label: string): ToolchainActivationState {
  const record = exactInput(input, ['bindings', 'cwd', 'files', 'vfsBackend'], label);
  const cwd = absolutePath(record.cwd, `${label} cwd`);
  if (record.vfsBackend !== 'opfs' && record.vfsBackend !== 'memory') {
    throw new TypeError(`${label} vfsBackend must be opfs or memory`);
  }
  if (!Array.isArray(record.bindings) || Object.getOwnPropertySymbols(record.bindings).length > 0) {
    throw new TypeError(`${label} bindings must be a dense array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(record.bindings);
  const indexKeys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (
    indexKeys.length !== record.bindings.length ||
    indexKeys.some((key, index) => key !== String(index)) ||
    indexKeys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === undefined || !('value' in descriptor);
    })
  ) {
    throw new TypeError(`${label} bindings must be a dense array`);
  }
  const bindings = indexKeys.map((key, index) => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} bindings must be a dense array`);
    }
    const value = descriptor.value;
    const binding = exactInput(value, ['adapterId', 'packagePath'], `${label} binding ${index}`);
    if (typeof binding.adapterId !== 'string' || binding.adapterId.length === 0) {
      throw new TypeError(`${label} binding ${index} adapterId must be a non-empty string`);
    }
    const packagePath = absolutePath(binding.packagePath, `${label} binding ${index} packagePath`);
    return Object.freeze({ adapterId: binding.adapterId, packagePath });
  });
  if (!Array.isArray(record.files) || Object.getOwnPropertySymbols(record.files).length > 0) {
    throw new TypeError(`${label} files must be a dense array`);
  }
  const fileDescriptors = Object.getOwnPropertyDescriptors(record.files);
  const fileKeys = Object.keys(fileDescriptors).filter((key) => key !== 'length');
  if (
    fileKeys.length !== record.files.length ||
    fileKeys.some((key, index) => key !== String(index)) ||
    fileKeys.some((key) => {
      const descriptor = fileDescriptors[key];
      return descriptor === undefined || !('value' in descriptor);
    })
  ) {
    throw new TypeError(`${label} files must be a dense array`);
  }
  const seen = new Set<string>();
  const files = fileKeys.map((key, index) => {
    const descriptor = fileDescriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} files must be a dense array`);
    }
    const file = exactInput(descriptor.value, ['data', 'path'], `${label} file ${index}`);
    const path = absolutePath(file.path, `${label} file ${index} path`);
    if (seen.has(path)) throw new TypeError(`${label} has duplicate file ${path}`);
    seen.add(path);
    if (!(file.data instanceof Uint8Array)) {
      throw new TypeError(`${label} file ${index} data must be Uint8Array`);
    }
    return Object.freeze({ path, data: new Uint8Array(file.data) });
  });
  return Object.freeze({
    cwd,
    bindings: Object.freeze(bindings),
    vfsBackend: record.vfsBackend,
    files: Object.freeze(files.toSorted((left, right) => left.path.localeCompare(right.path))),
  });
}
