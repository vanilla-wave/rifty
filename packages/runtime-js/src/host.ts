import type {
  EvalResult,
  FsReadEncoding,
  FsRequest,
  FsResult,
  HostMessage,
  SerializedRuntimeError,
  TelemetrySnapshot,
  VmEngineName,
  WorkerMessage,
} from './protocol.ts';

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

interface PendingFs {
  resolve(result: FsResult): void;
  reject(err: unknown): void;
}

interface RuntimeError extends Error {
  code?: string;
  path?: string;
}

/**
 * Host-side controller for the JS runtime Worker. Hides the message protocol.
 */
export function spawnRuntime(opts: RuntimeOptions): RuntimeController {
  const handlers = new Set<(event: RuntimeEvent) => void>();
  let worker: Worker | null = null;
  let nextId = 1;
  let ready = false;
  const pending = new Map<number, PendingEval>();
  const pendingFs = new Map<number, PendingFs>();

  function emit(event: RuntimeEvent): void {
    for (const h of handlers) {
      try {
        h(event);
      } catch (err) {
        console.error('runtime listener threw', err);
      }
    }
  }

  function send(message: HostMessage): void {
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
    return err;
  }

  function rejectPendingFs(err: unknown): void {
    for (const p of pendingFs.values()) {
      p.reject(err);
    }
    pendingFs.clear();
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
      pendingFs.set(request.id, { resolve, reject });
    });
    try {
      send({ type: 'fs', request });
    } catch (err) {
      pendingFs.delete(request.id);
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
    const result = await requestFs({ id: nextId++, op: 'writeFile', path, data });
    if (!result.ok) throw deserializeError(result.error);
  }

  function start(): void {
    worker = new Worker(opts.workerUrl, { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ready':
          ready = true;
          // Apply the programmatic vm-engine override (ADR-0142) before anything
          // runs, so the first eval already sees the chosen engine.
          if (opts.vmEngine) send({ type: 'vm-config', engine: opts.vmEngine });
          if (opts.fixture) send({ type: 'load-fixture', files: opts.fixture });
          emit({ type: 'ready' });
          break;
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
          const p = pendingFs.get(msg.result.id);
          if (p) {
            pendingFs.delete(msg.result.id);
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
      for (const p of pending.values()) {
        p.reject(
          Object.assign(new Error(`Worker crashed: ${event.message}`), {
            code: 'WORKER_CRASHED',
          }),
        );
      }
      pending.clear();
      rejectPendingFs(
        Object.assign(new Error(`Worker crashed: ${event.message}`), {
          code: 'WORKER_CRASHED',
        }),
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

  start();

  const fs: RuntimeFs = { readFile, writeFile };

  return {
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
        rejectPendingFs(workerTerminatedError('Worker was reset'));
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
      rejectPendingFs(workerTerminatedError('Worker was disposed'));
      handlers.clear();
      pending.clear();
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
}
