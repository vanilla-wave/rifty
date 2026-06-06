/**
 * Node-compatible `node:worker_threads` (subset).
 *
 * Spinning up a real module Worker per `new Worker('./script')` would require
 * runtime-side rebundling, so for M6 a `Worker` is a lightweight in-process
 * scope running the script through our loader, with MessageChannel-style IPC.
 * Enough for fan-out-concurrency packages to work (single-threaded, correct API
 * surface). True parallelism is a follow-up.
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
  /** ADR-0011 phase 2: when present, backed by a real `kernel.spawnWorker`
   * realm and `terminate` routes through it. */
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
    // ADR-0011 phase 2: real Worker realm via kernel.spawnWorker when
    // capability + host wiring permit.
    if (isSabIpcSupported() && getKernelWorkerUrl() !== null) {
      this.startViaKernel();
      return;
    }
    // ADR-0011 fallback: in-realm polyfill violates worker_threads' separate-
    // event-loop promise, so warn loudly (once per import) but don't throw —
    // conformance + integration paths still rely on same-realm propagation.
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
      // Phase 3 will wire worker-side `parentPort`; until then surface binary
      // stdio as 'stdout'/'stderr' events for debug visibility.
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
      // child → parent: worker's parentPort.postMessage → 'message' on the handle.
      parentPort.postMessage = (msg) => this.outbound.emit('message', msg);
      this.outbound.on('message', (msg) => this.emit('message', msg));
      // parent → child: worker.postMessage → 'message' on the worker's parentPort.
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

/** One-shot guard: same-realm warning fires once per module import. Reset via
 * {@link _resetFallbackWarnState} for tests only. */
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

/** Test-only: reset the one-shot warn guard. Not public API. */
export function _resetFallbackWarnState(): void {
  fallbackWarnFired = false;
}

export const isMainThread = true;
export const parentPort: EventEmitter | null = null;
export const threadId = 1;

/**
 * Object-graph tags backing `markAsUntransferable` / `markAsUncloneable`.
 *
 * Node stores these flags on internal V8 slots for the native structured-clone
 * serializer. With no in-realm hook into that serializer we use module-scoped
 * `WeakSet`s, which preserve the parity-observable contract (marks round-trip,
 * add no enumerable own properties, re-marking is a no-op) without faking a
 * serializer. Consulted by any in-realm clone / port-transfer path (e.g. a
 * future `MessagePort.postMessage`); the same-realm `Worker` fallback passes by
 * reference and never clones, so it enforces nothing.
 */
const untransferable = new WeakSet<object>();
const uncloneable = new WeakSet<object>();

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Tag `object` so it is cloned (not transferred) when passed to
 * `postMessage(value, [transferList])`. Mirrors Node: ignores non-objects.
 *
 * @param object - Candidate to mark. Non-objects are ignored.
 */
export function markAsUntransferable(object: unknown): void {
  if (isObjectLike(object)) untransferable.add(object);
}

/**
 * Report whether `object` was tagged by {@link markAsUntransferable}. `false`
 * for primitives/null/undefined, matching Node.
 *
 * @param object - Candidate to test.
 * @returns `true` iff the object carries the untransferable mark.
 */
export function isMarkedAsUntransferable(object: unknown): boolean {
  return isObjectLike(object) && untransferable.has(object);
}

/**
 * Tag `object` so it throws `DataCloneError` if cloned via structuredClone /
 * `postMessage`. undici marks every web-platform class instance this way in its
 * constructor (`webidl.util.markAsUncloneable`), so we record the tag for an
 * in-realm clone path to honour. Mirrors Node: ignores non-objects.
 *
 * @param object - Candidate to mark. Non-objects are ignored.
 */
export function markAsUncloneable(object: unknown): void {
  if (isObjectLike(object)) uncloneable.add(object);
}

/**
 * Report whether `object` was tagged by {@link markAsUncloneable}. Not in
 * Node's public `worker_threads` surface — for rifty's in-realm clone path.
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
