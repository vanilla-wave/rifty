/**
 * The consumer's pool of worker processes (pool ADR): calls packed SHARD to a
 * worker; a lost worker's calls rerun once, each alone on a solo worker;
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
  REFUSED,
  type RunRequest,
  SHARD,
  STUCK_GRACE_MS,
  type SandboxRun,
  type WorkerRequest,
} from './protocol.ts';

// `src/` in the workspace and `dist/` when packed are both one level under the package root.
const WORKER_ENTRY = fileURLToPath(new URL('../dist/child.js', import.meta.url));
/** How long a closed result channel waits for the worker's own exit to explain it. */
export const CHANNEL_END_GRACE_MS = 50;
const MAX_CALL_ID = 2 ** 32 - 1;

export type Termination = 'timeout' | 'memory';
export interface Result {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly termination?: Termination;
  readonly truncated?: true;
  /** A sandbox run's end state (ADR-0568), validated by the sandbox before use. */
  readonly state?: Uint8Array;
  readonly stateRefused?: (typeof REFUSED)[number];
}
export interface CallSpec {
  readonly allowSharedArrayBuffer: boolean;
  readonly code: string;
  readonly timeoutMs: number;
  readonly memoryLimitMb: number;
  readonly maxOutputBytes: number;
  /**
   * A sandbox run. `state()` encodes the state again for each attempt (the sandbox's
   * files do not change while its run is in flight), so the call holds no copy of it
   * between writes; on the wire its base64 is written in pieces.
   */
  readonly sandbox?: Omit<SandboxRun, 'state'> & { readonly state: () => Uint8Array };
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
  /** A sandbox run's `state` frame, or its `refused` reason, of this attempt. */
  state: Uint8Array | undefined;
  refused: number | undefined;
  attempts = 0;
  settled = false;
  /** Settled here at the deadline; the worker still owes its terminal frame. */
  cancelled = false;
  /** Why the previous attempt's worker was lost. */
  lost: string | undefined;
  worker: Worker | undefined;
  readonly deadline: NodeJS.Timeout;
  /**
   * Resolves once the call has left for good: settled, and its isolate on no worker
   * (the worker's `gone` frame, or its end). One event per call, from its creation:
   * whoever holds it waits through every placement and rerun (ADR-0568 §5).
   */
  readonly left: Promise<void>;
  #leave: () => void = () => {};
  #hasLeft = false;
  /** Someone awaits `left`: the process stays up until it resolves (workers are unref'd). */
  held = false;
  #hold: NodeJS.Timeout | undefined;
  #stuck: NodeJS.Timeout | undefined;
  constructor(
    readonly id: number,
    readonly spec: CallSpec,
    private readonly resolve: (r: Result) => void,
    private readonly reject: (e: Error) => void,
    onDeadline: (call: Call) => void,
  ) {
    this.deadline = setTimeout(() => onDeadline(this), spec.timeoutMs);
    this.left = new Promise((resolve) => {
      this.#leave = resolve;
    });
  }
  /**
   * After the call settled or its worker let it go: has it left? A settled call whose
   * isolate is still on a worker gets that worker's stuck-isolate grace (ADR-0563 §4):
   * past it the worker is retired as if it had said so itself — no new call, ended once
   * its calls are settled — so a worker that never sends `gone` cannot hold anyone forever.
   */
  checkLeft(): void {
    if (this.#hasLeft || !this.settled) return;
    const worker = this.worker;
    if (worker !== undefined && !worker.dead && worker.running.has(this.id)) {
      if (this.held) this.#hold ??= setInterval(() => {}, 2 ** 30);
      this.#stuck ??= setTimeout(() => worker.retireStuck(), STUCK_GRACE_MS).unref();
      return;
    }
    this.#hasLeft = true;
    clearInterval(this.#hold);
    clearTimeout(this.#stuck);
    this.#leave();
  }
  /** A fresh attempt: nothing of the previous one reaches the result. */
  restart(): void {
    this.out = new FdBytes();
    this.err = new FdBytes();
    this.kept = 0;
    this.truncated = false;
    this.state = undefined;
    this.refused = undefined;
    this.attempts++;
  }
  result(exitCode: number | null, termination?: Termination): Result {
    const refused = this.refused === undefined ? undefined : REFUSED[this.refused];
    return {
      stdout: this.out.text(),
      stderr: this.err.text(),
      // A state the run could not restore: no guest code ran.
      exitCode: this.refused === 0 ? null : exitCode,
      ...(termination === undefined ? {} : { termination }),
      ...(this.truncated ? { truncated: true as const } : {}),
      ...(this.state === undefined ? {} : { state: this.state }),
      ...(refused === undefined ? {} : { stateRefused: refused }),
    };
  }
  resolveWith(result: Result): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.deadline);
    this.resolve(result);
    this.checkLeft();
  }
  rejectWith(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.deadline);
    this.reject(error);
    this.checkLeft();
  }
}

/** `isolate-host child …`, coded so a consumer can retry: a call lost with its worker (pool ADR). */
function lostError(message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_ISOLATE_HOST_WORKER_LOST' });
}

class Worker {
  /** Calls placed here that have no terminal frame yet. */
  readonly calls = new Map<number, Call>();
  /**
   * Calls whose isolate has not stopped yet: placed, until the worker's `gone` frame
   * (after the terminal frame) or its end. They hold a slot (ADR-0563 §7).
   */
  readonly running = new Map<number, Call>();
  retiring = false;
  dead = false;
  exited = false;
  /** Its result channel ended: it can answer nothing, so it takes no call and is never idle. */
  channelEnded = false;
  /**
   * Why the consumer itself ended this worker; unset = an exit nobody asked for.
   * `done`: nothing left on it (idle, retired, solo finished).
   */
  ended:
    | { readonly violation: string }
    | { readonly lost: string }
    | { readonly done: true }
    | undefined;
  readonly child: ChildProcess;
  constructor(
    private readonly pool: Pool,
    /** Holds one rerun call, takes no other, ends with it. */
    readonly solo: boolean,
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
    // Judged after one poll past the grace: a loop turn runs due timers before I/O,
    // so a preempted consumer finds the grace due and an exit that came in time still
    // unread. (Not the deadline: reading late, it cannot tell a frame sent in time
    // from one sent after — backlog distribution/isolate-host-starved-deadline-outcome.)
    frames?.on('end', () => {
      this.channelEnded = true;
      setTimeout(() => {
        setImmediate(() => {
          if (!this.dead && this.ended === undefined) {
            this.ended = { lost: 'after closing its result channel without a result' };
            this.kill();
          }
        });
      }, CHANNEL_END_GRACE_MS).unref();
    });
    // Exited, its stdio still draining: no new call goes here.
    child.on('exit', () => {
      this.exited = true;
    });
    child.on('error', (error) => {
      // Only a failed spawn ends here; a live worker's failure arrives as 'exit'.
      if (child.pid !== undefined || this.dead) return;
      this.dead = true;
      this.pool.forget(this);
      // A rerun's worker that cannot start (ENOENT, EAGAIN, EMFILE — a mass loss is when
      // they come): the call is lost, with the code a consumer retries on.
      for (const call of this.calls.values())
        call.rejectWith(
          call.lost === undefined
            ? error
            : lostError(
                `${call.lost}; its rerun could not start (${String((error as NodeJS.ErrnoException).code ?? error.message)})`,
              ),
        );
      this.calls.clear();
      this.#releaseAll();
    });
    // 'close', not 'exit': every frame the worker wrote is read before its loss is judged.
    child.on('close', (code, signal) => this.#exited(code, signal));
  }

  /** The worker ended: every isolate on it is gone with it. */
  #releaseAll(): void {
    const calls = [...this.running.values()];
    this.running.clear();
    for (const call of calls) call.checkLeft();
  }

  /** A settled call's isolate outlived the grace here: retire as the worker itself would. */
  retireStuck(): void {
    if (this.dead || this.ended !== undefined) return;
    this.retiring = true;
    this.pool.settleWorker(this);
  }

  send(request: WorkerRequest): void {
    this.child.stdin?.write(`${JSON.stringify(request)}\n`);
  }

  /**
   * Send `call` here. Everything that can throw — the request, a sandbox run's state —
   * is built before the call is registered, so a throw leaves no phantom call (no slot,
   * no waiter). A write that throws after registration (half a line on the wire) ends
   * this worker as lost and rethrows: the caller rejects the call with that error.
   */
  place(call: Call): void {
    const { code, memoryLimitMb, maxOutputBytes, sandbox } = call.spec;
    const request: RunRequest = {
      type: 'run',
      allowSharedArrayBuffer: call.spec.allowSharedArrayBuffer,
      call: call.id,
      code,
      memoryLimitMb,
      maxOutputBytes,
      ...(this.solo ? { solo: true as const } : {}),
      // `state` last and empty: its base64 is streamed into the line below.
      ...(sandbox
        ? {
            sandbox: {
              path: sandbox.path,
              args: sandbox.args,
              maxFsBytes: sandbox.maxFsBytes,
              state: '',
            },
          }
        : {}),
    };
    const line = JSON.stringify(request);
    const state = sandbox?.state();
    call.worker = this;
    this.calls.set(call.id, call);
    this.running.set(call.id, call);
    const stdin = this.child.stdin;
    try {
      if (state === undefined) {
        stdin?.write(`${line}\n`);
        return;
      }
      // The same JSON line, written in pieces: the state's base64 never becomes one string
      // (the consumer's memory per run, ADR-0568 §6).
      const at = line.lastIndexOf('""}}');
      stdin?.write(line.slice(0, at + 1));
      const step = 3 << 20; // a multiple of 3: the pieces join into one base64 text
      for (let from = 0; from < state.byteLength; from += step)
        stdin?.write(
          Buffer.from(
            state.buffer,
            state.byteOffset + from,
            Math.min(step, state.byteLength - from),
          ).toString('base64'),
        );
      stdin?.write('"}}\n');
    } catch (error) {
      // Half a line on the wire: this worker can read no further request. It ends as lost
      // (its other calls rerun); this call rejects with the error, no rerun (the caller's).
      if (this.ended === undefined) {
        this.ended = { lost: 'after a request it could not be sent whole' };
        this.kill();
      }
      throw error;
    }
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
    if (kind === KIND.gone)
      return this.running.has(id) && !this.calls.has(id)
        ? 0
        : `gone for call ${id}, not ended on this worker`;
    const call = this.calls.get(id);
    if (call === undefined) return `frame for call ${id}, not in flight on this worker`;
    switch (kind) {
      case KIND.output:
        return 2 + (call.spec.maxOutputBytes - call.kept);
      case KIND.state:
      case KIND.refused: {
        const sandbox = call.spec.sandbox;
        if (sandbox === undefined) return `state frame for call ${id}, not a sandbox run`;
        if (call.state !== undefined || call.refused !== undefined)
          return `second state frame for call ${id}`;
        return kind === KIND.state ? sandbox.maxFsBytes : 1;
      }
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
    if (kind === KIND.gone) {
      // The call's isolate has stopped: its slot is free, whoever waits for it may go on.
      const call = this.running.get(id);
      this.running.delete(id);
      call?.checkLeft();
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
    if (kind === KIND.state) {
      call.state = p;
      return undefined;
    }
    if (kind === KIND.refused) {
      if (p.byteLength !== 1 || (p[0] as number) >= REFUSED.length) return 'refused payload';
      call.refused = p[0];
      return undefined;
    }
    if (kind === KIND.exit && p.byteLength !== 1) return 'exit payload';
    // An honest worker ends a sandbox run it was not told to cancel with its state.
    if (
      kind === KIND.exit &&
      call.spec.sandbox !== undefined &&
      !call.cancelled &&
      call.state === undefined &&
      call.refused === undefined
    )
      return 'sandbox run ended without its state';
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
    this.#releaseAll();
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

/** A sandbox's hold on one of its calls (ADR-0568 §5). */
export interface CallHandle {
  abort(error: Error): void;
  left(): Promise<void>;
}

let shared: Pool | undefined;
/** One pool per consumer process, created by the first call (`runCode` and sandbox runs). */
export function sharedPool(): Pool {
  shared ??= new Pool();
  return shared;
}

export class Pool {
  readonly #workers: Worker[] = [];
  #nextId = 1;

  /**
   * `handle.abort(error)` (a destroyed sandbox): reject with `error` now and
   * dispose the isolate as at a deadline. `handle.left()`: the call's one
   * "left for good" event (`Call.left`), valid from `onStart` on — its result out
   * and its isolate gone, whichever comes last, through every rerun; awaiting it
   * keeps the process up.
   */
  run(spec: CallSpec, onStart?: (handle: CallHandle) => void): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      const id = this.#nextId;
      this.#nextId = id === MAX_CALL_ID ? 1 : id + 1;
      const call = new Call(id, spec, resolve, reject, (c) => this.#deadline(c));
      onStart?.({
        abort: (error) => {
          call.rejectWith(error);
          this.#cancel(call);
        },
        left: () => {
          call.held = true;
          call.checkLeft();
          return call.left;
        },
      });
      call.restart();
      try {
        this.#placeFresh(call);
      } catch (error) {
        // spawn threw synchronously: settle now, and clear the deadline that would hold the process.
        call.rejectWith(error as Error);
      }
    });
  }

  /** Packed: the oldest worker with a free slot that takes fresh calls, else a new one. */
  #placeFresh(call: Call): void {
    const worker =
      this.#workers.find(
        (w) =>
          !w.solo &&
          !w.retiring &&
          !w.exited &&
          !w.channelEnded &&
          w.ended === undefined &&
          w.running.size < SHARD,
      ) ?? this.#spawn(false);
    worker.place(call);
  }

  #spawn(solo: boolean): Worker {
    const worker = new Worker(this, solo);
    this.#workers.push(worker);
    return worker;
  }

  /**
   * The calls of a lost worker with no culprit: each reruns once, alone, on a
   * solo worker (I5, ADR-0563 Corrections 2026-11-19). There any exhaustion is
   * that call's own: an RSS crossing is its `memory`. Processes at most equal the
   * calls lost: never more than one process per call.
   */
  rerun(lost: readonly Call[], reason: string): void {
    for (const call of lost) {
      if (call.attempts >= 2) {
        call.rejectWith(lostError(reason));
        continue;
      }
      call.lost = reason;
      call.restart();
      let solo: Worker | undefined;
      try {
        solo = this.#spawn(true);
        solo.place(call);
      } catch {
        // A solo that got no call has nothing to do: it ends at once.
        solo?.end();
        // spawn throws synchronously (ENOMEM, a bad path): this runs in a 'close'
        // handler, so a throw would take the consumer down. The call is lost.
        call.rejectWith(lostError(reason));
      }
    }
  }

  #deadline(call: Call): void {
    // F1: a rerun keeps the original deadline; out of budget it is a lost call, not a timeout.
    if (call.lost !== undefined)
      call.rejectWith(lostError(`${call.lost}; its rerun did not finish within timeoutMs`));
    else call.resolveWith(call.result(null, 'timeout'));
    this.#cancel(call);
  }

  /** The call is settled here: its worker disposes its isolate. */
  #cancel(call: Call): void {
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
    if (worker.retiring || worker.solo) {
      worker.end();
      return;
    }
    if (worker.running.size > 0) return;
    // Keep one idle worker warm; a second idle one ends.
    const idle = this.#workers.filter(
      (w) =>
        !w.solo && !w.retiring && !w.channelEnded && w.ended === undefined && w.running.size === 0,
    );
    if (idle.length > 1) worker.end();
  }

  forget(worker: Worker): void {
    const at = this.#workers.indexOf(worker);
    if (at >= 0) this.#workers.splice(at, 1);
  }
}
