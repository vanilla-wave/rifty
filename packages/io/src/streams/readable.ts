/**
 * Node-compatible `node:stream.Readable` — owned by `@riftydev/io` per ADR-0012.
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
  /**
   * Coalescing flag: at most one `flow()` microtask is pending. A burst of
   * push() calls in one tick schedules one flow turn, not one per push (flow()
   * already drains the whole buffer synchronously).
   */
  flowScheduled: boolean;
}

export function chunkSize(chunk: unknown): number {
  if (chunk == null) return 0;
  if (typeof chunk === 'string') return chunk.length;
  if (chunk instanceof Uint8Array) return chunk.length;
  return 1;
}

/**
 * Per-instance decode state set by `setEncoding(enc)`. The text encodings that
 * `TextDecoder` covers are decoded with a single persistent decoder in
 * `{ stream: true }` mode so a multi-byte character split across chunk
 * boundaries decodes correctly (matching Node's `StringDecoder`); byte-group
 * encodings (`hex`/`base64`/`base64url`) and `ascii` are decoded per-chunk via
 * `Buffer.toString` (Node's `ascii` is 7-bit, distinct from TextDecoder's
 * windows-1252 alias — so route it through Buffer for exactness).
 */
interface EncodingState {
  /** Node's canonical name (`readableEncoding` + the `Buffer.toString` arg). */
  label: string;
  decoder: TextDecoder | null;
}

/**
 * Node encoding name / alias → { canonical name, TextDecoder label or null }.
 * The TextDecoder set (utf8/utf16le/latin1) is streaming-decoded; the rest
 * (ascii/hex/base64/base64url) fall through to a per-chunk `Buffer.toString`
 * using the canonical name (all valid `Buffer` encodings).
 */
const ENCODINGS: Record<string, { canonical: string; td: string | null }> = {
  utf8: { canonical: 'utf8', td: 'utf-8' },
  'utf-8': { canonical: 'utf8', td: 'utf-8' },
  utf16le: { canonical: 'utf16le', td: 'utf-16le' },
  'utf-16le': { canonical: 'utf16le', td: 'utf-16le' },
  ucs2: { canonical: 'utf16le', td: 'utf-16le' },
  'ucs-2': { canonical: 'utf16le', td: 'utf-16le' },
  latin1: { canonical: 'latin1', td: 'latin1' },
  binary: { canonical: 'latin1', td: 'latin1' },
  ascii: { canonical: 'ascii', td: null },
  hex: { canonical: 'hex', td: null },
  base64: { canonical: 'base64', td: null },
  base64url: { canonical: 'base64url', td: null },
};

function makeEncodingState(encoding: string): EncodingState {
  const entry = ENCODINGS[String(encoding).toLowerCase()];
  if (!entry) {
    const err = new TypeError(`Unknown encoding: ${encoding}`) as TypeError & { code?: string };
    err.code = 'ERR_UNKNOWN_ENCODING';
    throw err;
  }
  return { label: entry.canonical, decoder: entry.td ? new TextDecoder(entry.td) : null };
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
      // Mixed byte/string queue happens only when `encoding` is set; per Node,
      // return whatever we have so far.
      state.buffer.shift();
      state.length -= chunkSize(head);
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
  if (state.buffer.length === 1) {
    const only = state.buffer.shift();
    if (only instanceof Uint8Array) state.length -= only.length;
    else state.length -= chunkSize(only);
    return only;
  }
  // Coalesce only over Uint8Array entries; if a string sneaks in, Node returns
  // string chunks individually.
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

/**
 * Minimal shape the destination must satisfy for `pipe()`. We avoid importing
 * `Writable` here to keep the inheritance direction one-way (Writable extends
 * the EventEmitter from this layer; depending on Writable from inside
 * readable.ts would invert the dep). The duck-type matches Node's pipe API.
 */
interface PipeableWritable extends EventEmitter {
  write(chunk: unknown): boolean;
  end(): unknown;
  emit: EventEmitter['emit'];
}

export class Readable extends EventEmitter implements AsyncIterable<unknown> {
  readonly _readableState: ReadableState;
  private readImpl?: (this: Readable, size: number) => void;
  /** Set by `setEncoding(enc)`; `null` means emit raw bytes (the default). */
  private encodingState: EncodingState | null = null;
  /**
   * Per-dest pipe cleanup. The key is the destination; the value tears down
   * every listener `pipe(dest)` attached on both ends. A `Map` (not array)
   * means `unpipe(dest)` removes all wirings to that dest in one call, even
   * when `pipe(dest)` was called multiple times — subsequent calls overwrite
   * the previous entry after running its cleanup.
   */
  private pipeCleanups: Map<PipeableWritable, () => void> = new Map();

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
      flowScheduled: false,
    };
    this.readImpl = opts.read;
    // Node applies the `encoding` option as if `setEncoding` ran in the ctor.
    if (opts.encoding) this.setEncoding(opts.encoding);
    this.on('newListener', (event) => {
      if (event === 'data' && this._readableState.flowing === null) {
        this._readableState.flowing = true;
        this.scheduleFlow();
      } else if (event === 'readable' && !this._readableState.endEmitted) {
        // Pump so a cold reader doesn't sit idle on a first chunk that's
        // already queued (Node fires `'readable'` once a chunk lands).
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

  get readableEncoding(): string | null {
    return this.encodingState?.label ?? null;
  }

  /**
   * `Readable.setEncoding(encoding)` — emit decoded **strings** (on `'data'`
   * and from `read()`) instead of raw bytes. Returns `this`. Throws
   * `ERR_UNKNOWN_ENCODING` for an unsupported encoding, like Node. The decode is
   * applied at the emit/return boundary (see {@link applyEncoding}); the
   * internal byte buffer + length accounting are unchanged, so this is a no-op
   * for any consumer that never calls it. Required by `@effect/platform-node`'s
   * `NodeStream.toString`, which calls `stream.setEncoding('utf8')` before
   * reading a request body — so every POST-with-body route depends on it.
   */
  setEncoding(encoding: string): this {
    this.encodingState = makeEncodingState(encoding);
    return this;
  }

  /**
   * Decode a chunk for delivery when an encoding is set. Byte chunks become
   * strings (streaming-decoded for the TextDecoder set; per-chunk Buffer decode
   * otherwise); strings, object-mode entries, and the no-encoding case pass
   * through unchanged.
   */
  private applyEncoding(chunk: unknown): unknown {
    const enc = this.encodingState;
    if (enc === null || this._readableState.objectMode) return chunk;
    if (typeof chunk === 'string' || !(chunk instanceof Uint8Array)) return chunk;
    if (enc.decoder) return enc.decoder.decode(chunk, { stream: true });
    return Buffer.from(chunk).toString(enc.label as Parameters<Buffer['toString']>[0]);
  }

  /** Force-start flow on next tick. Used by `Readable.from`. */
  protected startFlowing(): void {
    if (this._readableState.flowing === null) this._readableState.flowing = true;
    this.scheduleFlow();
  }

  push(chunk: unknown): boolean {
    const state = this._readableState;
    if (chunk === null) {
      state.ended = true;
      if (state.flowing) this.scheduleFlow();
      else {
        // Paused readers still need `end`; fire a final `'readable'` first so
        // `read(n)`-on-`'readable'` consumers can drain the tail (Node fires
        // `'readable'` once more at EOF, then `read()` returns null).
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
      this.scheduleFlow();
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
    // `read(0)` is a peek in Node: schedule `_read`, return null.
    if (n === 0) {
      this.maybeRead();
      return null;
    }
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
      if (!state.ended) this.maybeRead();
      else if (state.length === 0 && !state.endEmitted) {
        state.endEmitted = true;
        queueMicrotask(() => this.emit('end'));
      }
      return this.applyEncoding(all);
    }
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
      // Synchronous pump: if `_read` enqueues enough we satisfy the request in
      // the same tick (Node's "_read may push synchronously" path).
      this.maybeRead(n);
      if (state.length < n) {
        // Producer ended with leftovers: return them (Node's final partial read).
        if (state.ended) {
          if (state.length > 0) {
            const partial = takeAll(state);
            if (!state.endEmitted) {
              state.endEmitted = true;
              queueMicrotask(() => this.emit('end'));
            }
            return this.applyEncoding(partial);
          }
          // Drained AND ended: schedule end. (Node fires `'readable'` once more
          // on EOF, but only after a successful read — none here, so skip it.)
          if (!state.endEmitted) {
            state.endEmitted = true;
            queueMicrotask(() => this.emit('end'));
          }
        }
        return null;
      }
    }
    const slice = sliceBuffer(state, n);
    if (state.length === 0 && state.ended && !state.endEmitted) {
      state.endEmitted = true;
      // Final `readable` so the consumer observes EOF before `end` fires.
      if (this.listenerCount('readable') > 0) {
        queueMicrotask(() => this.emit('readable'));
      }
      queueMicrotask(() => this.emit('end'));
    } else if (!state.ended && state.length < state.highWaterMark) {
      this.maybeRead();
    }
    return this.applyEncoding(slice);
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

  /**
   * Schedule one `flow()` microtask, coalescing repeats. A burst of push()
   * calls (or resume/start) in one tick enqueues at most one flow turn; flow()
   * drains the whole buffer synchronously, so the extra turns were redundant.
   */
  private scheduleFlow(): void {
    const state = this._readableState;
    if (state.flowScheduled) return;
    state.flowScheduled = true;
    queueMicrotask(() => {
      state.flowScheduled = false;
      this.flow();
    });
  }

  private flow(): void {
    const state = this._readableState;
    while (state.flowing && state.buffer.length > 0) {
      const chunk = state.buffer.shift();
      state.length -= state.objectMode ? 1 : chunkSize(chunk);
      const out = this.applyEncoding(chunk);
      // A streaming decoder returns '' while it buffers an incomplete multi-byte
      // sequence — Node does not surface an empty `'data'` in that case.
      if (out !== '') this.emit('data', out);
    }
    this.finishIfDone();
    if (
      state.flowing &&
      this.readImpl &&
      !state.ended &&
      state.length < state.highWaterMark &&
      !state.reading
    ) {
      this.maybeRead();
      // If `_read` enqueued synchronously, drain again on the next tick.
      if (state.buffer.length > 0 && state.flowing) this.scheduleFlow();
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
    this.scheduleFlow();
    return this;
  }

  pause(): this {
    const state = this._readableState;
    if (state.flowing === false) return this;
    state.flowing = false;
    this.emit('pause');
    return this;
  }

  /**
   * Connect a source `Readable` to a destination `Writable`.
   *
   * Symmetric wiring (improves on the pre-fix shape that left dangling
   * listeners on either side after an error):
   *   - source `'data'` → `dest.write()` (pause on backpressure);
   *   - source `'end'`  → `dest.end()` (unless `opts.end === false`);
   *   - source `'error'`→ propagate to dest then cleanup the wiring;
   *   - dest   `'drain'`→ resume source;
   *   - dest   `'error'`→ cleanup the wiring on both ends;
   *   - dest   `'close'`→ cleanup the wiring on both ends.
   *
   * Multiple `pipe(dest, …)` calls to the same destination overwrite the
   * previous wiring (the old cleanup runs first). This keeps the Map-per-dest
   * contract — `unpipe(dest)` removes all of this readable's wirings to that
   * destination in one call.
   *
   * @param dest Writable-like sink (anything matching {@link PipeableWritable}).
   * @param opts `{end?: boolean}` — when `false`, source's `end` does NOT call
   *   `dest.end()`. Default `true`, matching Node.
   */
  pipe<W extends PipeableWritable>(dest: W, opts: { end?: boolean } = {}): W {
    // Already piping to this dest: clean up first so the listener count returns
    // to baseline; the new wiring replaces it.
    const existing = this.pipeCleanups.get(dest);
    if (existing) existing();

    const endOnFinish = opts.end ?? true;
    const onData = (chunk: unknown): void => {
      if (!dest.write(chunk)) this.pause();
    };
    const onDrain = (): void => {
      this.resume();
    };
    const onEnd = (): void => {
      if (endOnFinish) dest.end();
    };
    const onSourceError = (err: unknown): void => {
      dest.emit('error', err);
      cleanup();
    };
    const onDestError = (_err: unknown): void => {
      cleanup();
    };
    const onDestClose = (): void => {
      cleanup();
    };
    const cleanup = (): void => {
      // Idempotent: only run once per pipe instance.
      if (this.pipeCleanups.get(dest) !== cleanup) return;
      this.pipeCleanups.delete(dest);
      this.off('data', onData);
      this.off('end', onEnd);
      this.off('error', onSourceError);
      dest.off('drain', onDrain);
      dest.off('error', onDestError);
      dest.off('close', onDestClose);
    };
    this.on('data', onData);
    this.on('end', onEnd);
    this.on('error', onSourceError);
    dest.on('drain', onDrain);
    dest.on('error', onDestError);
    dest.on('close', onDestClose);
    this.pipeCleanups.set(dest, cleanup);
    return dest;
  }

  /**
   * Detach the wiring installed by `pipe(dest)`. With no argument, detach
   * every active wiring. With a destination, detach just that one. Mirrors
   * Node's `Readable.unpipe(dest?)`.
   */
  unpipe<W extends PipeableWritable>(dest?: W): this {
    if (dest === undefined) {
      // Iterate over a snapshot — each cleanup mutates pipeCleanups.
      for (const cleanup of [...this.pipeCleanups.values()]) cleanup();
      return this;
    }
    const cleanup = this.pipeCleanups.get(dest);
    if (cleanup) cleanup();
    return this;
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

  /**
   * Per Node's `Readable[Symbol.asyncIterator]` contract:
   *   - listeners attached for the iteration are torn down on completion
   *     (natural end, error, consumer throw, or early `break`/`return`);
   *   - on early termination (break/return/throw before EOF) the source is
   *     destroyed — signalling the producer that the consumer is done. This
   *     mirrors Node's behaviour where the iterator's `return()` calls
   *     `destroy()` on the stream so generators/HTTP responses don't keep
   *     pumping into a dead consumer.
   *
   * We hand-roll the iterator (rather than `async function*`) so we can
   * implement `return()` and `throw()` to run the same cleanup path.
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
    let resolveNext: ((v: IteratorResult<unknown>) => void) | null = null;
    let rejectNext: ((err: unknown) => void) | null = null;
    const pending: unknown[] = [];
    let sourceEnded = false;
    let error: unknown = null;
    let cleanedUp = false;
    /** Set only when `next()` returns `{done:true}` because the consumer fully
     *  drained the stream — distinguishes natural completion from early
     *  termination (break/return/throw before draining). */
    let naturallyDrained = false;

    const onData = (chunk: unknown): void => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        rejectNext = null;
        r({ value: chunk, done: false });
      } else {
        pending.push(chunk);
      }
    };
    const onEnd = (): void => {
      sourceEnded = true;
      // Wake a pending next() only if nothing is buffered; otherwise the
      // consumer is mid-iteration and sees end naturally.
      if (pending.length === 0 && resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        rejectNext = null;
        naturallyDrained = true;
        r({ value: undefined, done: true });
      }
    };
    const onError = (err: unknown): void => {
      error = err;
      if (rejectNext) {
        const rj = rejectNext;
        resolveNext = null;
        rejectNext = null;
        rj(err);
      }
    };

    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.off('data', onData);
      this.off('end', onEnd);
      this.off('error', onError);
      // Pause to stop emitting; if iteration ended before the consumer drained,
      // also destroy — Node's iterator return() does this so the producer
      // learns the consumer is gone.
      this.pause();
      if (!naturallyDrained && !error && !this._readableState.destroyed) this.destroy();
    };

    this.on('data', onData);
    this.on('end', onEnd);
    this.on('error', onError);

    const iter: AsyncIterableIterator<unknown> = {
      next: (): Promise<IteratorResult<unknown>> => {
        if (error) {
          const err = error;
          error = null;
          cleanup();
          return Promise.reject(err);
        }
        if (pending.length > 0) {
          return Promise.resolve({ value: pending.shift(), done: false });
        }
        if (sourceEnded) {
          naturallyDrained = true;
          cleanup();
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<unknown>>((resolve, reject) => {
          resolveNext = (r) => {
            if (r.done) cleanup();
            resolve(r);
          };
          rejectNext = (err) => {
            cleanup();
            reject(err);
          };
        });
      },
      return: (value?: unknown): Promise<IteratorResult<unknown>> => {
        cleanup();
        return Promise.resolve({ value, done: true });
      },
      throw: (err?: unknown): Promise<IteratorResult<unknown>> => {
        cleanup();
        return Promise.reject(err);
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
        return iter;
      },
    };
    return iter;
  }

  /**
   * Create a `Readable` from any sync or async iterable.
   *
   * Mode detection (when `options.objectMode` is NOT supplied):
   *   - first chunk is a `string`, `Uint8Array`, or `Buffer` → byte mode
   *     (`objectMode: false`);
   *   - otherwise → object mode.
   *
   * When `options.objectMode` IS supplied it always wins — the caller knows.
   *
   * Non-iterable inputs throw `TypeError` synchronously (Node's contract).
   *
   * @param iter Any `Iterable` or `AsyncIterable`. A bare `string` qualifies
   *   (it iterates char-by-char) and `Buffer`/`Uint8Array` also qualify
   *   (they iterate byte-by-byte). Whether you want chars-as-chunks or
   *   bytes-as-chunks is up to you — pass the iterable shape you want.
   * @param options Optional `ReadableOptions`. `highWaterMark` and
   *   `objectMode` are honoured; other fields are forwarded.
   */
  static from(
    iter: Iterable<unknown> | AsyncIterable<unknown>,
    options: ReadableOptions = {},
  ): Readable {
    // Surface bad input as Node does: TypeError before any state is created.
    if (iter == null || (typeof iter !== 'object' && typeof iter !== 'string')) {
      throw new TypeError(
        `Readable.from: the "iterable" argument must be iterable. Received type ${typeof iter}`,
      );
    }
    const sym = (iter as { [Symbol.iterator]?: unknown })[Symbol.iterator];
    const asyncSym = (iter as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
    if (typeof sym !== 'function' && typeof asyncSym !== 'function') {
      throw new TypeError(
        'Readable.from: the "iterable" argument must implement Symbol.iterator or Symbol.asyncIterator',
      );
    }

    // Build the runtime iterator now so we can peek the first chunk for mode
    // detection without re-consuming the source.
    let iterator: AsyncIterator<unknown> | Iterator<unknown>;
    let isAsync = false;
    if (typeof asyncSym === 'function') {
      iterator = (asyncSym as () => AsyncIterator<unknown>).call(iter);
      isAsync = true;
    } else {
      iterator = (sym as () => Iterator<unknown>).call(iter);
    }

    // Peek the first chunk to detect byte vs object mode when objectMode is not
    // explicit; the peek is pushed back before the pump.
    let firstResult: IteratorResult<unknown> | Promise<IteratorResult<unknown>> | null = null;
    let resolvedMode: boolean;
    if (options.objectMode !== undefined) {
      resolvedMode = options.objectMode;
    } else if (!isAsync) {
      const r = (iterator as Iterator<unknown>).next();
      firstResult = r;
      if (r.done) {
        // Empty iterable defaults to objectMode true (Node-like).
        resolvedMode = true;
      } else {
        const v = r.value;
        resolvedMode = !(v instanceof Uint8Array || typeof v === 'string');
      }
    } else {
      // Can't peek an async iterator without making `from` async; default to
      // objectMode true — Node's default for `Readable.from(asyncIter)`.
      resolvedMode = true;
    }

    const r = new Readable({
      highWaterMark: options.highWaterMark,
      objectMode: resolvedMode,
      encoding: options.encoding,
    });

    void (async () => {
      try {
        // Push the peeked first chunk (sync-iterator branch only).
        if (firstResult !== null && !(firstResult as IteratorResult<unknown>).done) {
          r.push((firstResult as IteratorResult<unknown>).value);
        }
        if (isAsync) {
          const ai = iterator as AsyncIterator<unknown>;
          while (true) {
            const step = await ai.next();
            if (step.done) break;
            r.push(step.value);
          }
        } else {
          const si = iterator as Iterator<unknown>;
          while (true) {
            const step = si.next();
            if (step.done) break;
            r.push(step.value);
          }
        }
        r.push(null);
      } catch (err) {
        r.destroy(err as Error);
      }
    })();
    return r;
  }
}
