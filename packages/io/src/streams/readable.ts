/**
 * Node-compatible `node:stream.Readable` — owned by `@rifty/io` per ADR-0012.
 *
 * Behaviour we replicate (excerpt from Node docs, normative for ADR-0034):
 *   - `_readableState` — single state container holding {buffer, length, flowing,
 *     ended, endEmitted, reading, destroyed, errored, highWaterMark, objectMode}.
 *     User code that touches `_readableState.flowing` etc. (Node ecosystem
 *     pattern — see `node-tap`, `pump`, `end-of-stream`) reads the same shape.
 *   - flowing/paused modes; `data` listener flips flowing on next tick.
 *   - `push(null)` ends the stream; `end` fires once buffer drains.
 *   - `read(n)`:
 *       * `n === 0` — peek; schedules `_read`, returns `null`.
 *       * `n` bytes available — slice and return exactly that many bytes
 *         (Buffers in byte mode, single entries in object mode).
 *       * `n` bytes NOT available — schedule `_read(min(hwm, n))`; if the
 *         synchronous `_read` enqueues enough during the call, return; else
 *         return `null` and schedule a re-pump for the consumer's next call.
 *       * `n === undefined` — return everything currently buffered as one chunk
 *         (Buffer.concat in byte mode, single entry in object mode).
 *   - `pipe(dest)` returns dest; respects backpressure via `pause/resume`.
 *   - `Readable.from(iter)` creates an object-mode stream from any iterable.
 *   - `destroy(err?)` — marks destroyed, emits `error` (if err) then `close`.
 */

import { Buffer } from '../buffer.ts';
import { EventEmitter } from '../event-emitter.ts';

export interface ReadableOptions {
  highWaterMark?: number;
  encoding?: string;
  objectMode?: boolean;
  read?(this: Readable, size: number): void;
}

/**
 * Single state container shared across all `Readable` instances per Node's
 * `_readableState` convention. Field names mirror Node's `internal/streams/state.js`;
 * we expose only the fields rifty's tests, downstream callers, or the wider
 * Node ecosystem read or write. Unused fields (e.g. `decoder`, `awaitDrain`)
 * are deliberately omitted — adding them silently would invite a downstream
 * caller to rely on a placeholder.
 */
export interface ReadableState {
  buffer: unknown[];
  /** Total byte (or entry, in object mode) count across `buffer`. */
  length: number;
  highWaterMark: number;
  objectMode: boolean;
  /**
   * `null` until the first consumer attaches; `true` while data flows;
   * `false` after `.pause()`.
   */
  flowing: boolean | null;
  /** `true` once `push(null)` has been called. */
  ended: boolean;
  /** `true` once the `'end'` event has fired. */
  endEmitted: boolean;
  /** Re-entrancy guard for `_read`. */
  reading: boolean;
  /** Set by `destroy(err)`. */
  destroyed: boolean;
  /** Error from `destroy(err)` if any. */
  errored: Error | null;
}

export function chunkSize(chunk: unknown): number {
  if (chunk == null) return 0;
  if (typeof chunk === 'string') return chunk.length;
  if (chunk instanceof Uint8Array) return chunk.length;
  return 1;
}

/**
 * Slice the first `n` bytes from a Buffer-mode `_readableState.buffer`,
 * coalescing across multiple queued chunks. Mutates `state.buffer` and
 * decrements `state.length` accordingly.
 *
 * Returns `null` if the buffer has fewer than `n` bytes.
 */
function sliceBuffer(state: ReadableState, n: number): Uint8Array | null {
  if (state.length < n) return null;
  // Fast path: first chunk satisfies the request exactly.
  const first = state.buffer[0];
  if (first instanceof Uint8Array && first.length === n) {
    state.buffer.shift();
    state.length -= n;
    return first;
  }
  // Slow path: collect/split.
  const out = Buffer.allocUnsafe(n);
  let written = 0;
  while (written < n && state.buffer.length > 0) {
    const head = state.buffer[0];
    if (!(head instanceof Uint8Array)) {
      // Non-buffer mixed in (e.g. a string in encoding mode) — fall back to a
      // single-chunk return; per Node, mixed byte/string queues happen only
      // when an `encoding` is set, which the consumer asked for.
      state.buffer.shift();
      state.length -= chunkSize(head);
      // Out-of-band: return whatever we have so far (rare, but defined).
      // Convert to a Buffer view of just what we wrote.
      return out.subarray(0, written);
    }
    const need = n - written;
    if (head.length <= need) {
      out.set(head, written);
      written += head.length;
      state.buffer.shift();
      state.length -= head.length;
    } else {
      out.set(head.subarray(0, need), written);
      state.buffer[0] = head.subarray(need);
      state.length -= need;
      written += need;
    }
  }
  return out;
}

/**
 * Take the entire buffer as one chunk for `read()` with no argument.
 * Byte mode: concatenate all queued Buffers into one. Object mode: return the
 * first entry (Node semantics — object-mode `read()` doesn't coalesce).
 */
function takeAll(state: ReadableState): unknown {
  if (state.buffer.length === 0) return null;
  if (state.objectMode) {
    const v = state.buffer.shift();
    state.length -= 1;
    return v;
  }
  // Byte mode. If a single chunk, return as-is.
  if (state.buffer.length === 1) {
    const only = state.buffer.shift();
    if (only instanceof Uint8Array) state.length -= only.length;
    else state.length -= chunkSize(only);
    return only;
  }
  // Coalesce — but only over Uint8Array entries; if a string sneaks in,
  // honour Node's behaviour of returning string chunks individually.
  let allBuffers = true;
  for (const c of state.buffer) {
    if (!(c instanceof Uint8Array)) {
      allBuffers = false;
      break;
    }
  }
  if (!allBuffers) {
    const v = state.buffer.shift();
    state.length -= chunkSize(v);
    return v;
  }
  const total = state.length;
  const out = Buffer.allocUnsafe(total);
  let off = 0;
  for (const c of state.buffer as Uint8Array[]) {
    out.set(c, off);
    off += c.length;
  }
  state.buffer.length = 0;
  state.length = 0;
  return out;
}

export class Readable extends EventEmitter implements AsyncIterable<unknown> {
  readonly _readableState: ReadableState;
  private readImpl?: (this: Readable, size: number) => void;

  constructor(opts: ReadableOptions = {}) {
    super();
    this._readableState = {
      buffer: [],
      length: 0,
      highWaterMark: opts.highWaterMark ?? 16 * 1024,
      objectMode: opts.objectMode ?? false,
      flowing: null,
      ended: false,
      endEmitted: false,
      reading: false,
      destroyed: false,
      errored: null,
    };
    this.readImpl = opts.read;
    this.on('newListener', (event) => {
      if (event === 'data' && this._readableState.flowing === null) {
        this._readableState.flowing = true;
        queueMicrotask(() => this.flow());
      } else if (event === 'readable' && !this._readableState.endEmitted) {
        // Node fires `'readable'` after a chunk lands in the buffer and the
        // consumer hasn't drained it. Schedule a pump so cold readers don't
        // sit idle waiting for the first chunk that's already queued.
        queueMicrotask(() => {
          if (this._readableState.buffer.length > 0 && !this._readableState.endEmitted) {
            this.emit('readable');
          }
          if (
            !this._readableState.ended &&
            !this._readableState.reading &&
            this.readImpl !== undefined
          ) {
            this._readableState.reading = true;
            try {
              this.readImpl.call(this, this._readableState.highWaterMark);
            } finally {
              this._readableState.reading = false;
            }
          }
        });
      }
    });
  }

  // ---- Public accessors that mirror Node's getters on `Readable`. ----

  get readable(): boolean {
    return (
      !this._readableState.destroyed &&
      !this._readableState.endEmitted &&
      !this._readableState.errored
    );
  }

  get readableHighWaterMark(): number {
    return this._readableState.highWaterMark;
  }

  get readableObjectMode(): boolean {
    return this._readableState.objectMode;
  }

  get readableLength(): number {
    return this._readableState.length;
  }

  get readableEnded(): boolean {
    return this._readableState.endEmitted;
  }

  get destroyed(): boolean {
    return this._readableState.destroyed;
  }

  /** Force-start flow on next tick. Used by `Readable.from`. */
  protected startFlowing(): void {
    if (this._readableState.flowing === null) this._readableState.flowing = true;
    queueMicrotask(() => this.flow());
  }

  push(chunk: unknown): boolean {
    const state = this._readableState;
    if (chunk === null) {
      state.ended = true;
      if (state.flowing) queueMicrotask(() => this.flow());
      else {
        // Paused/unflowing readers still need an `end` event.
        // Also fire `'readable'` one more time so consumers using the
        // `read(n)`-on-`'readable'` pattern get a chance to drain the tail
        // before `'end'`. Per Node: a final `'readable'` event fires when
        // EOF is reached, and `read()` returns `null` after the tail drains.
        queueMicrotask(() => {
          if (this.listenerCount('readable') > 0 && !state.endEmitted) {
            this.emit('readable');
          }
          this.finishIfDone();
        });
      }
      return false;
    }
    if (state.ended) {
      // Push after EOF is a programming error in Node — emit error.
      const err = new Error('stream.push() after EOF');
      queueMicrotask(() => this.emit('error', err));
      return false;
    }
    if (state.destroyed) return false;
    state.buffer.push(chunk);
    state.length += state.objectMode ? 1 : chunkSize(chunk);
    if (state.flowing) {
      queueMicrotask(() => this.flow());
    } else if (this.listenerCount('readable') > 0) {
      queueMicrotask(() => {
        if (!state.endEmitted) this.emit('readable');
      });
    }
    return state.length < state.highWaterMark;
  }

  /**
   * `read(n)` — see file-level doc for the contract. Honours `n` (vs. the
   * pre-ADR-0034 implementation which ignored it).
   */
  read(n?: number): unknown {
    const state = this._readableState;
    // Node treats `read(0)` as a peek: schedules `_read` and returns null.
    if (n === 0) {
      this.maybeRead();
      return null;
    }
    // No argument — return everything available as one chunk (or null).
    if (n === undefined) {
      if (state.length === 0) {
        if (state.ended && !state.endEmitted) {
          state.endEmitted = true;
          queueMicrotask(() => this.emit('end'));
        } else {
          this.maybeRead();
        }
        return null;
      }
      const all = takeAll(state);
      // After draining the buffer, kick off a re-pump if we're not ended.
      if (!state.ended) this.maybeRead();
      else if (state.length === 0 && !state.endEmitted) {
        state.endEmitted = true;
        queueMicrotask(() => this.emit('end'));
      }
      return all;
    }
    // n is a positive number.
    // Object mode: `n` is meaningless past 1; return one entry.
    if (state.objectMode) {
      if (state.length === 0) {
        if (state.ended && !state.endEmitted) {
          state.endEmitted = true;
          queueMicrotask(() => this.emit('end'));
        } else {
          this.maybeRead();
        }
        return null;
      }
      const v = state.buffer.shift();
      state.length -= 1;
      if (!state.ended && state.length < state.highWaterMark) this.maybeRead();
      return v ?? null;
    }
    // Byte mode: exact-n semantics.
    if (state.length < n) {
      // Try a synchronous pump — if `_read` enqueues enough, this satisfies
      // the request in the same tick (matches Node's "_read may push
      // synchronously" path).
      this.maybeRead(n);
      if (state.length < n) {
        // If the producer has ended and there's nothing more coming, return
        // whatever's left (Node's behaviour for the final partial read).
        if (state.ended) {
          if (state.length > 0) {
            const partial = takeAll(state);
            if (!state.endEmitted) {
              state.endEmitted = true;
              queueMicrotask(() => this.emit('end'));
            }
            return partial;
          }
          // Buffer drained AND ended: schedule end + return null. Also fire a
          // final `readable` event so `read(n)`-on-`readable` consumers get a
          // chance to observe the EOF transition before `end` fires (Node
          // contract — readable fires once more on EOF after the last
          // successful read).
          if (!state.endEmitted) {
            state.endEmitted = true;
            queueMicrotask(() => this.emit('end'));
          }
        }
        return null;
      }
    }
    const slice = sliceBuffer(state, n);
    // If buffer drained completely and the producer has ended, queue end.
    if (state.length === 0 && state.ended && !state.endEmitted) {
      state.endEmitted = true;
      // Also fire a final `readable` so the consumer can observe EOF before
      // `end` fires.
      if (this.listenerCount('readable') > 0) {
        queueMicrotask(() => this.emit('readable'));
      }
      queueMicrotask(() => this.emit('end'));
    } else if (!state.ended && state.length < state.highWaterMark) {
      this.maybeRead();
    }
    return slice;
  }

  /**
   * Schedule a synchronous `_read` call if the source has more to give and a
   * read isn't already in flight. Caller passes the desired size hint; default
   * is the current high-water headroom.
   */
  private maybeRead(hint?: number): void {
    const state = this._readableState;
    if (state.ended || state.reading || !this.readImpl || state.destroyed) return;
    const size = hint ?? Math.max(state.highWaterMark - state.length, 1);
    state.reading = true;
    try {
      this.readImpl.call(this, size);
    } finally {
      state.reading = false;
    }
  }

  private flow(): void {
    const state = this._readableState;
    while (state.flowing && state.buffer.length > 0) {
      const chunk = state.buffer.shift();
      state.length -= state.objectMode ? 1 : chunkSize(chunk);
      this.emit('data', chunk);
    }
    this.finishIfDone();
    if (
      state.flowing &&
      this.readImpl &&
      !state.ended &&
      state.length < state.highWaterMark &&
      !state.reading
    ) {
      // Pump the underlying source for more.
      this.maybeRead();
      // If `_read` enqueued synchronously, drain again on the next tick.
      if (state.buffer.length > 0 && state.flowing) queueMicrotask(() => this.flow());
    }
  }

  private finishIfDone(): void {
    const state = this._readableState;
    if (state.ended && !state.endEmitted && state.length === 0) {
      state.endEmitted = true;
      this.emit('end');
    }
  }

  resume(): this {
    const state = this._readableState;
    if (state.flowing === true) return this;
    state.flowing = true;
    this.emit('resume');
    queueMicrotask(() => this.flow());
    return this;
  }

  pause(): this {
    const state = this._readableState;
    if (state.flowing === false) return this;
    state.flowing = false;
    this.emit('pause');
    return this;
  }

  pipe<
    W extends {
      write(chunk: unknown): boolean;
      end(): unknown;
      emit: EventEmitter['emit'];
    } & EventEmitter,
  >(dest: W, opts: { end?: boolean } = {}): W {
    const endOnFinish = opts.end ?? true;
    const onData = (chunk: unknown) => {
      if (!dest.write(chunk)) this.pause();
    };
    const onDrain = () => this.resume();
    const onEnd = () => {
      if (endOnFinish) dest.end();
    };
    const onError = (err: unknown) => {
      dest.emit('error', err);
      cleanup();
    };
    const cleanup = (): void => {
      this.off('data', onData);
      this.off('end', onEnd);
      this.off('error', onError);
      dest.off('drain', onDrain);
    };
    this.on('data', onData);
    this.on('end', onEnd);
    this.on('error', onError);
    dest.on('drain', onDrain);
    return dest;
  }

  destroy(err?: Error): this {
    const state = this._readableState;
    if (state.destroyed) return this;
    state.destroyed = true;
    if (err) state.errored = err;
    // Emit on next tick so synchronous chained `destroy(err)` calls can attach
    // listeners before the event fires (matches Node's `process.nextTick`).
    queueMicrotask(() => {
      if (err) this.emit('error', err);
      this.emit('close');
    });
    return this;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    let resolveNext: ((v: IteratorResult<unknown>) => void) | null = null;
    const pending: unknown[] = [];
    let done = false;
    let error: unknown = null;
    const push = (chunk: unknown): void => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: chunk, done: false });
      } else {
        pending.push(chunk);
      }
    };
    this.on('data', push);
    this.on('end', () => {
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined, done: true });
      }
    });
    this.on('error', (err) => {
      error = err;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined, done: true });
      }
    });
    while (true) {
      if (error) throw error;
      if (pending.length > 0) {
        yield pending.shift();
        continue;
      }
      if (done) return;
      yield await new Promise<unknown>((resolve) => {
        resolveNext = (r) => resolve(r.value);
      });
    }
  }

  static from(iter: Iterable<unknown> | AsyncIterable<unknown>): Readable {
    const r = new Readable({ objectMode: true });
    void (async () => {
      try {
        for await (const v of iter as AsyncIterable<unknown>) r.push(v);
        r.push(null);
      } catch (err) {
        r.destroy(err as Error);
      }
    })();
    return r;
  }
}
