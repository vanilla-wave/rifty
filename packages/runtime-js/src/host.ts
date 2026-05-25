import type { EvalResult, HostMessage, WorkerMessage } from './protocol.ts';

export interface RuntimeOptions {
  /** URL of the worker entry module. */
  readonly workerUrl: string;
  /** Optional pre-populated fixture for the in-Worker VFS (path → source). */
  readonly fixture?: Readonly<Record<string, string>>;
}

export type RuntimeEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'stdout'; readonly chunk: string }
  | { readonly type: 'stderr'; readonly chunk: string }
  | { readonly type: 'result'; readonly result: EvalResult }
  | { readonly type: 'exit'; readonly reason: 'reset' | 'error' };

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
  /** Terminate and respawn the worker. */
  reset(): Promise<void>;
  dispose(): void;
  on(handler: (event: RuntimeEvent) => void): () => void;
  /** Write a file into the in-Worker VFS. Used for editor↔runtime sync (M10). */
  writeFile(path: string, content: string): void;
  readonly isReady: () => boolean;
}

interface PendingEval {
  resolve(result: EvalResult): void;
  reject(err: unknown): void;
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

  function start(): void {
    worker = new Worker(opts.workerUrl, { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ready':
          ready = true;
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
        case 'pong':
          break;
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
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
