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
  private exited = false;
  private readonly outbound: EventEmitter = new EventEmitter();
  private readonly inbound: EventEmitter = new EventEmitter();

  constructor(script: string, opts: WorkerOptions = {}) {
    super();
    this.threadId = nextThreadId++;
    this.script = script;
    this.workerData = opts.workerData;
    queueMicrotask(() => this.start());
  }

  private start(): void {
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
          this.terminate(1);
        },
      );
    } catch (err) {
      this.emit('error', err);
      this.terminate(1);
    }
  }

  postMessage(msg: unknown): void {
    this.inbound.emit('message', msg);
  }

  async terminate(code = 0): Promise<number> {
    if (this.exited) return code;
    this.exited = true;
    this.emit('exit', code);
    return code;
  }
}

let nextThreadId = 2;

export const isMainThread = true;
export const parentPort: EventEmitter | null = null;
export const threadId = 1;

const worker_threads = { Worker, isMainThread, parentPort, threadId };
export default worker_threads;
