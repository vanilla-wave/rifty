/**
 * The consumer's pool of worker processes (pool ADR): calls packed SHARD to a
 * worker; a lost worker's calls rerun once, together, on a worker of their own;
 * a retiring worker takes no new call and dies once its calls are settled.
 * Workers are unref'd: only a pending call (its deadline timer) keeps the
 * consumer alive. A worker may be hostile (isolate escape): its frames are
 * judged against what this consumer placed on it.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  FRAME_CHANNEL_FD,
  FrameReader,
  KIND,
  MAX_ERROR_TEXT,
  type RunRequest,
  SHARD,
  type WorkerRequest,
} from './protocol.ts';

// `src/` in the workspace and `dist/` when packed are both one level under the package root.
const WORKER_ENTRY = fileURLToPath(new URL('../dist/child.js', import.meta.url));
/** How long a closed result channel waits for the worker's own exit to explain it. */
const CHANNEL_END_GRACE_MS = 50;
const MAX_CALL_ID = 2 ** 32 - 1;

export type Termination = 'timeout' | 'memory';
export interface Result {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly termination?: Termination;
  readonly truncated?: true;
}
export interface CallSpec {
  readonly code: string;
  readonly timeoutMs: number;
  readonly memoryLimitMb: number;
  readonly maxOutputBytes: number;
}

/** Accepted output, copied into one growable buffer: never a view into a received chunk. */
class FdBytes {
  #buf = new Uint8Array(0);
  #len = 0;
  append(bytes: Uint8Array): void {
    if (this.#len + bytes.byteLength > this.#buf.byteLength) {
      const grown = new Uint8Array(
        Math.max(this.#len + bytes.byteLength, this.#buf.byteLength * 2, 4096),
      );
      grown.set(this.#buf.subarray(0, this.#len));
      this.#buf = grown;
    }
    this.#buf.set(bytes, this.#len);
    this.#len += bytes.byteLength;
  }
  text(): string {
    return Buffer.from(this.#buf.buffer, 0, this.#len).toString('utf8');
  }
}

class Call {
  out = new FdBytes();
  err = new FdBytes();
  /** What the consumer accepted in this attempt: the state each frame is judged against. */
  kept = 0;
  truncated = false;
  attempts = 0;
  settled = false;
  /** Settled here at the deadline; the worker still owes its terminal frame. */
  cancelled = false;
  /** Why the previous attempt's worker was lost. */
  lost: string | undefined;
  worker: Worker | undefined;
  readonly deadline: NodeJS.Timeout;
  constructor(
    readonly id: number,
    readonly spec: CallSpec,
    private readonly resolve: (r: Result) => void,
    private readonly reject: (e: Error) => void,
    onDeadline: (call: Call) => void,
  ) {
    this.deadline = setTimeout(() => onDeadline(this), spec.timeoutMs);
  }
  /** A fresh attempt: nothing of the previous one reaches the result. */
  restart(): void {
    this.out = new FdBytes();
    this.err = new FdBytes();
    this.kept = 0;
    this.truncated = false;
    this.attempts++;
  }
  result(exitCode: number | null, termination?: Termination): Result {
    return {
      stdout: this.out.text(),
      stderr: this.err.text(),
      exitCode,
      ...(termination === undefined ? {} : { termination }),
      ...(this.truncated ? { truncated: true as const } : {}),
    };
  }
  resolveWith(result: Result): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.deadline);
    this.resolve(result);
  }
  rejectWith(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.deadline);
    this.reject(error);
  }
}

/** `isolate-host child …`, coded so a consumer can retry: a call lost with its worker (pool ADR). */
function lostError(message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_ISOLATE_HOST_WORKER_LOST' });
}

class Worker {
  /** Calls placed here that have no terminal frame yet. */
  readonly calls = new Map<number, Call>();
  retiring = false;
  dead = false;
  /**
   * Why the consumer itself ended this worker; unset = an exit nobody asked for.
   * `done`: nothing left on it (idle, retired, quarantine finished).
   */
  ended:
    | { readonly violation: string }
    | { readonly lost: string }
    | { readonly done: true }
    | undefined;
  readonly child: ChildProcess;
  constructor(
    private readonly pool: Pool,
    readonly quarantine: boolean,
  ) {
    this.child = spawn(process.execPath, ['--no-node-snapshot', WORKER_ENTRY], {
      env: {},
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    });
    const child = this.child;
    // Idle workers never keep the consumer alive; a pending call's deadline does.
    child.unref();
    const stdin = child.stdin as (Socket & NodeJS.WritableStream) | null;
    stdin?.unref();
    // A worker that died meanwhile surfaces through 'exit', not an EPIPE.
    stdin?.on('error', () => {});
    const frames = child.stdio[FRAME_CHANNEL_FD] as (Socket & NodeJS.ReadableStream) | null;
    frames?.unref();
    frames?.on('error', () => {});
    const reader = new FrameReader((kind, call) => this.#maxPayload(kind, call));
    frames?.on('data', (chunk: Buffer) => {
      if (this.ended !== undefined) return;
      const bad = reader.push(chunk, (kind, call, payload) =>
        this.ended === undefined ? this.#onFrame(kind, call, payload) : undefined,
      );
      if (bad !== null) this.#violated(bad);
    });
    // A closed channel is a lost worker, unless its own exit explains it first.
    frames?.on('end', () => {
      setTimeout(() => {
        if (!this.dead && this.ended === undefined) {
          this.ended = { lost: 'after closing its result channel without a result' };
          this.kill();
        }
      }, CHANNEL_END_GRACE_MS).unref();
    });
    child.on('error', (error) => {
      // Only a failed spawn ends here; a live worker's failure arrives as 'exit'.
      if (child.pid !== undefined || this.dead) return;
      this.dead = true;
      this.pool.forget(this);
      for (const call of this.calls.values()) call.rejectWith(error);
      this.calls.clear();
    });
    // 'close', not 'exit': every frame the worker wrote is read before its loss is judged.
    child.on('close', (code, signal) => this.#exited(code, signal));
  }

  send(request: WorkerRequest): void {
    this.child.stdin?.write(`${JSON.stringify(request)}\n`);
  }

  place(call: Call): void {
    call.worker = this;
    this.calls.set(call.id, call);
    const { code, memoryLimitMb, maxOutputBytes } = call.spec;
    const request: RunRequest = { type: 'run', call: call.id, code, memoryLimitMb, maxOutputBytes };
    this.send(request);
  }

  kill(): void {
    this.child.kill('SIGKILL');
  }

  /** Nothing left to do here: from now on no call is placed on it, and its exit loses nothing. */
  end(): void {
    if (this.ended !== undefined) return;
    this.ended = { done: true };
    this.kill();
  }

  /** Largest payload a frame may carry now, or the violation. */
  #maxPayload(kind: number, id: number): number | string {
    if (kind === KIND.retire) return id === 0 ? 0 : `retire for call ${id}`;
    const call = this.calls.get(id);
    if (call === undefined) return `frame for call ${id}, not in flight on this worker`;
    switch (kind) {
      case KIND.output:
        return 2 + (call.spec.maxOutputBytes - call.kept);
      case KIND.exit:
        return 1;
      case KIND.memory:
        return 0;
      case KIND.error:
        return MAX_ERROR_TEXT;
      default:
        return `frame kind ${kind}`;
    }
  }

  /** One frame within its size bound, judged against the call's state; a string is the violation. */
  #onFrame(kind: number, id: number, p: Uint8Array): string | undefined {
    if (kind === KIND.retire) {
      this.retiring = true;
      this.pool.settleWorker(this);
      return undefined;
    }
    const call = this.calls.get(id) as Call;
    if (kind === KIND.output) {
      const fd = p[0];
      const truncated = p[1] === 0 ? false : p[1] === 1 ? true : null;
      if (p.byteLength < 2 || (fd !== 1 && fd !== 2) || truncated === null) return 'output header';
      const bytes = p.subarray(2);
      if (call.truncated && !truncated) return 'output truncation reverted';
      if (bytes.byteLength === 0 && !(truncated && !call.truncated))
        return 'output without new bytes';
      call.truncated ||= truncated;
      call.kept += bytes.byteLength;
      // A cancelled call's late bytes are judged, then dropped: its result is out.
      if (!call.cancelled) (fd === 2 ? call.err : call.out).append(bytes);
      return undefined;
    }
    if (kind === KIND.exit && p.byteLength !== 1) return 'exit payload';
    this.calls.delete(id);
    if (kind === KIND.exit) call.resolveWith(call.result(p[0] as number));
    else if (kind === KIND.memory) call.resolveWith(call.result(null, 'memory'));
    else if (kind === KIND.error)
      call.rejectWith(new Error(`isolate-host child failed: ${new TextDecoder().decode(p)}`));
    this.pool.settleWorker(this);
    return undefined;
  }

  /** A hostile worker: it ends, and every call still on it rejects. No rerun. */
  #violated(what: string): void {
    if (this.ended !== undefined) return;
    this.ended = { violation: what };
    this.kill();
    for (const call of this.calls.values())
      call.rejectWith(new Error(`isolate-host child protocol violation: ${what}`));
  }

  #exited(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.dead) return;
    this.dead = true;
    this.pool.forget(this);
    const ended = this.ended;
    if (ended !== undefined && 'violation' in ended) return;
    // Everything still unsettled here was lost with this worker.
    const detail = ended !== undefined && 'lost' in ended ? ` ${ended.lost}` : '';
    const reason = `isolate-host child exited unexpectedly (code ${code}, signal ${signal})${detail}`;
    const lost = [...this.calls.values()].filter((call) => !call.settled);
    this.calls.clear();
    this.pool.rerun(lost, reason);
  }
}

export class Pool {
  readonly #workers: Worker[] = [];
  #nextId = 1;

  run(spec: CallSpec): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      const id = this.#nextId;
      this.#nextId = id === MAX_CALL_ID ? 1 : id + 1;
      const call = new Call(id, spec, resolve, reject, (c) => this.#deadline(c));
      call.restart();
      this.#placeFresh(call);
    });
  }

  /** Packed: the oldest worker with a free slot that takes fresh calls, else a new one. */
  #placeFresh(call: Call): void {
    const worker =
      this.#workers.find(
        (w) => !w.quarantine && !w.retiring && w.ended === undefined && w.calls.size < SHARD,
      ) ?? this.#spawn(false);
    worker.place(call);
  }

  #spawn(quarantine: boolean): Worker {
    const worker = new Worker(this, quarantine);
    this.#workers.push(worker);
    return worker;
  }

  /** The calls of one lost worker: rerun once, together, on a worker of their own (I5). */
  rerun(lost: readonly Call[], reason: string): void {
    const again: Call[] = [];
    for (const call of lost) {
      if (call.attempts >= 2) call.rejectWith(lostError(reason));
      else {
        call.lost = reason;
        call.restart();
        again.push(call);
      }
    }
    if (again.length === 0) return;
    const quarantine = this.#spawn(true);
    for (const call of again) quarantine.place(call);
  }

  #deadline(call: Call): void {
    // F1: a rerun keeps the original deadline; out of budget it is a lost call, not a timeout.
    if (call.lost !== undefined)
      call.rejectWith(lostError(`${call.lost}; its rerun did not finish within timeoutMs`));
    else call.resolveWith(call.result(null, 'timeout'));
    const worker = call.worker;
    if (worker === undefined || worker.dead || !worker.calls.has(call.id)) return;
    call.cancelled = true;
    worker.send({ type: 'cancel', call: call.id });
    this.settleWorker(worker);
  }

  /** After a call or the worker's state changed: end what has nothing left to do. */
  settleWorker(worker: Worker): void {
    if (worker.dead || worker.ended !== undefined) return;
    const unsettled = [...worker.calls.values()].some((call) => !call.settled);
    if (unsettled) return;
    if (worker.retiring || worker.quarantine) {
      worker.end();
      return;
    }
    if (worker.calls.size > 0) return;
    // Keep one idle worker warm; a second idle one ends.
    const idle = this.#workers.filter(
      (w) => !w.quarantine && !w.retiring && w.ended === undefined && w.calls.size === 0,
    );
    if (idle.length > 1) worker.end();
  }

  forget(worker: Worker): void {
    const at = this.#workers.indexOf(worker);
    if (at >= 0) this.#workers.splice(at, 1);
  }
}
