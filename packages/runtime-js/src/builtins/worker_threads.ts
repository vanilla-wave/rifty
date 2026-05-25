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
} from '@rifty/kernel';
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
    // fallback per ADR-0011 — in-realm polyfill (single-threaded).
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
      // as `'stdout'`/`'stderr'` events for debug visibility.
      const ports = handle.ports;
      if (ports) {
        ports.stdout.onmessage = (ev) => this.emit('stdout', ev.data);
        ports.stderr.onmessage = (ev) => this.emit('stderr', ev.data);
        ports.stdout.start();
        ports.stderr.start();
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

export const isMainThread = true;
export const parentPort: EventEmitter | null = null;
export const threadId = 1;

const worker_threads = { Worker, isMainThread, parentPort, threadId };
export default worker_threads;
