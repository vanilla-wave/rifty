/**
 * Node-compatible `node:worker_threads` (subset).
 *
 * In the browser, every Node `Worker` is a `Web Worker` under the hood — but
 * spinning up a new module Worker for each `new Worker('./script')` would
 * require runtime-side rebundling. For M6 we approximate: a `Worker` is a
 * lightweight in-process scope that runs the script through our loader, with
 * a `MessageChannel`-style IPC to the parent.
 *
 * This is enough for Node packages that use `worker_threads` for fan-out
 * concurrency to "work" (single-threaded but with the correct API surface).
 * True parallelism waits for a follow-up: file an OPEN_QUESTIONS entry when
 * a real `worker_threads` parallel implementation is in scope.
 */

import {
  type ProcessHandle,
  type SpawnWorkerSpec,
  getKernelWorkerUrl,
  globalProcessManager,
  isSabIpcSupported,
} from '@riftydev/kernel';
import { Buffer } from './buffer.ts';
import { EventEmitter } from './events.ts';
import { syncMirror } from './fs-sync-mirror.ts';

interface WorkerOptions {
  workerData?: unknown;
  env?: Record<string, string>;
}

export class Worker extends EventEmitter {
  static isMainThread = true;
  threadId: number;
  private readonly script: string;
  private readonly workerData: unknown;
  private readonly env: Record<string, string>;
  private exited = false;
  private readonly outbound: EventEmitter = new EventEmitter();
  private readonly inbound: EventEmitter = new EventEmitter();
  /** ADR-0011 phase 2: when present, this Worker is backed by a real
   * `kernel.spawnWorker` Worker realm and `terminate` routes through it. */
  private workerHandle: ProcessHandle | null = null;

  constructor(script: string, opts: WorkerOptions = {}) {
    super();
    this.threadId = nextThreadId++;
    this.script = script;
    this.workerData = opts.workerData;
    this.env = opts.env ?? {};
    queueMicrotask(() => this.start());
  }

  private start(): void {
    // ADR-0011 phase 2 — real Worker realm via kernel.spawnWorker when
    // capability + host wiring permit.
    if (isSabIpcSupported() && getKernelWorkerUrl() !== null) {
      this.startViaKernel();
      return;
    }
    // Fallback per ADR-0011 — in-realm polyfill (single-threaded). The
    // fallback violates worker_threads' core promise (separate event loop),
    // so emit a loud one-shot warning per module import. Stays loud-but-not-
    // throwing because conformance + several integration paths still rely on
    // the same-realm behaviour (workerData/parentPort propagation works).
    warnSameRealmFallbackOnce();
    this.startSameRealm();
  }

  private startViaKernel(): void {
    try {
      const source = Buffer.from(syncMirror().readFileBytesSync(this.script)).toString();
      const spec: SpawnWorkerSpec = {
        entry: { kind: 'source', code: source, sourceUrl: this.script },
        argv: ['rifty', this.script],
        env: this.env,
        cwd: '/workspace',
      };
      const handle = globalProcessManager.spawnWorker('node', spec);
      this.workerHandle = handle;
      // Pump stdout/stderr → emit on `this` so consumers can hook
      // `worker.on('message', ...)` etc. once phase 3 wires worker-side
      // `parentPort`. Until then, the binary stdio is best-effort surfaced
      // as `'stdout'`/`'stderr'` events for debug visibility. The kernel
      // handle's `stdout()`/`stderr()` accessors hide the start/onmessage
      // boilerplate (follow-ups doc item #3).
      if (handle.kind === 'worker') {
        handle.stdout().on('data', (chunk) => this.emit('stdout', chunk));
        handle.stderr().on('data', (chunk) => this.emit('stderr', chunk));
      }
      handle.on('exit', (code) => {
        this.exited = true;
        this.emit('exit', typeof code === 'number' ? code : 1);
      });
    } catch (err) {
      this.emit('error', err);
      void this.terminate(1);
    }
  }

  private startSameRealm(): void {
    try {
      const source = Buffer.from(syncMirror().readFileBytesSync(this.script)).toString();
      const parentPort = new EventEmitter() as EventEmitter & {
        postMessage(msg: unknown): void;
      };
      // child → parent: parentPort.postMessage in the worker becomes a
      // `'message'` event on the Worker handle.
      parentPort.postMessage = (msg) => this.outbound.emit('message', msg);
      this.outbound.on('message', (msg) => this.emit('message', msg));
      // parent → child: messages sent via worker.postMessage land on
      // parentPort as `'message'` events inside the worker.
      this.inbound.on('message', (msg) => parentPort.emit('message', msg));

      const fn = new Function(
        'parentPort',
        'workerData',
        `${source}\n//# sourceURL=${this.script}`,
      ) as (parentPort: unknown, workerData: unknown) => unknown;
      Promise.resolve(fn(parentPort, this.workerData)).then(
        () => this.terminate(0),
        (err) => {
          this.emit('error', err);
          void this.terminate(1);
        },
      );
    } catch (err) {
      this.emit('error', err);
      void this.terminate(1);
    }
  }

  postMessage(msg: unknown): void {
    this.inbound.emit('message', msg);
  }

  async terminate(code = 0): Promise<number> {
    if (this.exited) return code;
    this.exited = true;
    if (this.workerHandle) {
      this.workerHandle.kill('SIGTERM');
    }
    this.emit('exit', code);
    return code;
  }
}

let nextThreadId = 2;

/** One-shot guard so the same-realm warning fires exactly once per module
 * import. Exported via {@link _resetFallbackWarnState} for tests only. */
let fallbackWarnFired = false;

function warnSameRealmFallbackOnce(): void {
  if (fallbackWarnFired) return;
  fallbackWarnFired = true;
  console.warn(
    '[rifty:worker_threads] Falling back to same-realm execution: ' +
      'kernel.spawnWorker capability not available ' +
      '(SAB IPC unsupported or kernelWorkerUrl not configured). ' +
      'workerData and parentPort still propagate, but this Worker shares ' +
      'the parent event loop — no real parallelism. ' +
      'To enable real Workers: ensure cross-origin isolation (SharedArrayBuffer) ' +
      'and call kernel.setKernelWorkerUrl(...) at host boot (ADR-0011 phase 2).',
  );
}

/** Test-only: reset the one-shot warn guard so a follow-up assertion can
 * verify the warning fires again. Not part of the package's public API. */
export function _resetFallbackWarnState(): void {
  fallbackWarnFired = false;
}

export const isMainThread = true;
export const parentPort: EventEmitter | null = null;
export const threadId = 1;

/**
 * Object-graph tags backing `markAsUntransferable` / `markAsUncloneable`.
 *
 * Node stores these flags on the object's internal V8 slots so the native
 * structured-clone serializer can consult them. We have no in-realm hook into
 * V8's serializer, so we keep the tags in module-scoped `WeakSet`s instead.
 * That preserves the parity-observable contract — `isMarkedAsUntransferable`
 * round-trips, the marks add no enumerable own properties, and re-marking is a
 * no-op — without inventing a fake serializer. The marks are consulted by any
 * rifty code path that re-implements structured clone / port transfer in-realm
 * (e.g. a future `MessagePort.postMessage`); the same-realm `Worker` fallback
 * passes messages by reference and never clones, so it has nothing to enforce.
 *
 * `WeakSet` membership is only meaningful for objects; the marker functions are
 * no-ops on primitives, exactly as Node's are.
 */
const untransferable = new WeakSet<object>();
const uncloneable = new WeakSet<object>();

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Tag `object` so it is cloned (not transferred) when passed to
 * `postMessage(value, [transferList])`. Node returns `undefined` and silently
 * ignores non-objects; we mirror both.
 *
 * @param object - Candidate to mark. Non-objects are ignored.
 */
export function markAsUntransferable(object: unknown): void {
  if (isObjectLike(object)) untransferable.add(object);
}

/**
 * Report whether `object` was tagged by {@link markAsUntransferable}. Returns
 * `false` for primitives, `null`, and `undefined` — matching Node.
 *
 * @param object - Candidate to test.
 * @returns `true` iff the object carries the untransferable mark.
 */
export function isMarkedAsUntransferable(object: unknown): boolean {
  return isObjectLike(object) && untransferable.has(object);
}

/**
 * Tag `object` so it throws `DataCloneError` if cloned via structuredClone /
 * `postMessage`. undici marks every web-platform class instance (Headers,
 * Request, Response, FormData, CacheStorage, WebSocket, EventTarget, ...) this
 * way in its constructor via `webidl.util.markAsUncloneable`. Node returns
 * `undefined` and ignores non-objects; we mirror both, and record the tag so an
 * in-realm clone path can honour it. The mark adds no enumerable own property.
 *
 * @param object - Candidate to mark. Non-objects are ignored.
 */
export function markAsUncloneable(object: unknown): void {
  if (isObjectLike(object)) uncloneable.add(object);
}

/**
 * Report whether `object` was tagged by {@link markAsUncloneable}. Not part of
 * Node's public `worker_threads` surface — exposed for rifty's own in-realm
 * clone path to consult the mark.
 *
 * @param object - Candidate to test.
 * @returns `true` iff the object carries the uncloneable mark.
 */
export function isMarkedAsUncloneable(object: unknown): boolean {
  return isObjectLike(object) && uncloneable.has(object);
}

const worker_threads = {
  Worker,
  isMainThread,
  parentPort,
  threadId,
  markAsUntransferable,
  isMarkedAsUntransferable,
  markAsUncloneable,
};
export default worker_threads;
