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
import { getDefaultHighWaterMark } from './default-highwatermark.ts';

export interface ReadableOptions {
  highWaterMark?: number;
  encoding?: string;
  objectMode?: boolean;
  // biome-ignore lint/suspicious/noConfusingVoidType: Node's `_read` returns void (sync) OR a promise (async backpressure) — the void|promise union IS the real Node signature; `undefined` would reject plain `read(){…}` (`() => void`) implementations.
  read?(this: Readable, size: number): void | PromiseLike<unknown>;
}

export interface ReadableToWebOptions {
  strategy?: QueuingStrategy<unknown>;
}

// biome-ignore lint/suspicious/noConfusingVoidType: matches ReadableOptions.read — void (sync) | promise (async backpressure), the real Node `_read` signature.
type ReadOverride = (this: Readable, size: number) => void | PromiseLike<unknown>;

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
   * Explicit "disturbed" bit (Node's `kIsDisturbed`) backing `isDisturbed`.
   * Set `true` once data has actually been consumed (a `read()` returning a
   * chunk, or a `'data'` emit in flowing mode) OR the stream is destroyed.
   * Fidelity: an EXPLICIT bit, never inferred from other state.
   */
  disturbed: boolean;
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
  write(chunk: unknown): boolean | Promise<boolean>;
  end(): unknown;
  emit: EventEmitter['emit'];
}

/** Node's `AbortError` shape (`name`/`code`), used when a web cancel carries no
 *  reason and to wrap a premature source close — mirrors `Readable.toWeb`. */
function abortError(cause?: unknown): Error {
  const err = new Error('The operation was aborted') as Error & { code?: string; cause?: unknown };
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  if (cause !== undefined) err.cause = cause;
  return err;
}

/** A source `destroy()`d before its natural end is a premature close; Node's
 *  `Readable.toWeb` surfaces it on the web stream as an `AbortError`. */
function prematureCloseError(): Error {
  const cause = new Error('Premature close') as Error & { code?: string };
  cause.code = 'ERR_STREAM_PREMATURE_CLOSE';
  return abortError(cause);
}

export class Readable extends EventEmitter implements AsyncIterable<unknown> {
  static toWeb(stream: Readable, options: ReadableToWebOptions = {}): ReadableStream {
    if (!(stream instanceof Readable)) {
      throw new TypeError('Readable.toWeb() expects a Readable stream');
    }
    let controller: ReadableStreamDefaultController<unknown> | null = null;
    let settled = false;
    // `cleanup({ keepErrorSink })` — drop the data/end/close listeners; the
    // 'error' listener is kept on cancel so the source `destroy()` below (which
    // Node makes emit 'error') never throws unhandled (rifty EventEmitter, like
    // Node, throws on an unhandled 'error').
    const cleanup = (keepErrorSink = false): void => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('close', onClose);
      if (!keepErrorSink) stream.off('error', onError);
    };
    const close = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      controller?.close();
    };
    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      controller?.error(err);
    };
    const onData = (chunk: unknown): void => {
      if (controller === null || settled) return;
      try {
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 1) <= 0) stream.pause();
      } catch (err) {
        fail(err);
      }
    };
    const onEnd = (): void => close();
    const onError = (err: unknown): void => fail(err);
    // 'close' fires only from `destroy()` (a natural end emits 'end', not
    // 'close'). Destroyed AFTER the end → clean EOF; destroyed BEFORE → the
    // source was torn down early, which Node reports as a premature close.
    const onClose = (): void => {
      if (settled) return;
      if (stream._readableState.endEmitted) close();
      else fail(prematureCloseError());
    };
    // A source whose terminal event already fired before `toWeb` was called
    // never re-fires it — settle from the current state on a microtask instead
    // of waiting forever (Node's `finished()` reports it the same tick).
    const settleFromTerminalState = (): void => {
      const st = stream._readableState;
      if (st.errored) fail(st.errored);
      else if (st.endEmitted) close();
      else if (st.destroyed) fail(prematureCloseError());
    };

    return new ReadableStream<unknown>(
      {
        start(c) {
          controller = c;
          const st = stream._readableState;
          if (st.errored || st.endEmitted || st.destroyed) {
            // Already terminal: keep only the 'error' sink (for a possible
            // cancel) and settle from state.
            stream.on('error', onError);
            queueMicrotask(settleFromTerminalState);
            return;
          }
          stream.on('data', onData);
          stream.on('end', onEnd);
          stream.on('error', onError);
          stream.on('close', onClose);
          stream.resume();
        },
        pull() {
          if (!settled) stream.resume();
        },
        cancel(reason) {
          if (settled) return;
          settled = true;
          cleanup(true); // keep the 'error' sink across the destroy below
          if (!stream.destroyed) {
            // Node forwards the cancel reason to the source's `destroy()`: a
            // null/undefined reason becomes an `AbortError`, any other reason
            // passes through and surfaces on the source's 'error' (cast: a
            // non-Error reason is intentionally forwarded verbatim, as Node does).
            stream.destroy(
              reason === undefined || reason === null ? abortError() : (reason as Error),
            );
          }
        },
      },
      options.strategy,
    );
  }

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
    const objectMode = opts.objectMode ?? false;
    this._readableState = {
      buffer: [],
      length: 0,
      highWaterMark: opts.highWaterMark ?? getDefaultHighWaterMark(objectMode),
      objectMode,
      flowing: null,
      ended: false,
      endEmitted: false,
      reading: false,
      destroyed: false,
      errored: null,
      disturbed: false,
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
          this.maybeRead(this._readableState.highWaterMark);
        });
      }
    });
  }

  _read(_size: number): void {}

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
      state.disturbed = true;
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
      state.disturbed = true;
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
            state.disturbed = true;
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
    state.disturbed = true;
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
    const readImpl = this.resolveRead();
    if (state.ended || state.reading || !readImpl || state.destroyed) return;
    const size = hint ?? Math.max(state.highWaterMark - state.length, 1);
    state.reading = true;
    let pending = false;
    try {
      const result = readImpl.call(this, size);
      if (isPromiseLike(result)) {
        pending = true;
        void result.then(
          () => {
            state.reading = false;
            if (
              state.flowing &&
              !state.ended &&
              !state.destroyed &&
              state.length < state.highWaterMark
            ) {
              this.maybeRead();
              if (state.buffer.length > 0) this.scheduleFlow();
            }
          },
          (err) => {
            state.reading = false;
            this.destroy(err instanceof Error ? err : new Error(String(err)));
          },
        );
        return;
      }
    } finally {
      if (!pending) state.reading = false;
    }
  }

  private resolveRead(): ReadOverride | undefined {
    if (this.readImpl) return this.readImpl;
    return this._read !== Readable.prototype._read ? this._read : undefined;
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
      if (out !== '') {
        // Delivering a chunk disturbs the stream (flowing-mode consumption).
        state.disturbed = true;
        this.emit('data', out);
      }
    }
    this.finishIfDone();
    if (
      state.flowing &&
      this.resolveRead() &&
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
      const writeResult = dest.write(chunk);
      if (writeResult === false) {
        this.pause();
        return;
      }
      if (isPromiseLike(writeResult)) {
        this.pause();
        void writeResult.then(
          () => this.resume(),
          (err) => {
            // Surface to dest, then tear the source down — otherwise it stays
            // paused-and-undestroyed and the producer leaks.
            dest.emit('error', err);
            this.destroy(err instanceof Error ? err : new Error(String(err)));
          },
        );
      }
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
    // Destroying disturbs the stream (Node: a destroyed stream is disturbed
    // even if never read from).
    state.disturbed = true;
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
    return this.createAsyncIterator(true);
  }

  /**
   * The hand-rolled async iterator shared by `[Symbol.asyncIterator]` and
   * `iterator({ destroyOnReturn })`. `destroyOnReturn` (default `true` for the
   * Symbol path) controls whether an early `return()`/`break`/`throw` ALSO
   * destroys the source: `true` mirrors Node's default (signal the producer the
   * consumer is gone); `false` detaches the listeners but leaves the stream
   * undestroyed and resumable (Node's `destroyOnReturn:false`).
   */
  private createAsyncIterator(destroyOnReturn: boolean): AsyncIterableIterator<unknown> {
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
      // learns the consumer is gone. `destroyOnReturn:false` skips the destroy
      // (the stream stays resumable), but still detaches the listeners above.
      this.pause();
      if (destroyOnReturn && !naturallyDrained && !error && !this._readableState.destroyed) {
        this.destroy();
      }
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

  // ──────────────────── async-iterator helpers (v17→v22) ────────────────────
  // Lazy transforms over `[Symbol.asyncIterator]()`. Stream-returning helpers
  // (`map`/`filter`/`flatMap`/`take`/`drop`) wrap a lazy async generator in
  // `Readable.from(gen, {objectMode:true})`; promise-returning helpers
  // (`forEach`/`reduce`/`toArray`/`some`/`every`/`find`) drain the iterator.
  // `map`/`filter`/`forEach`/`flatMap` accept `{ concurrency, signal }`:
  // concurrency>1 runs N callbacks at once but emits/observes results in INPUT
  // order; `signal` aborts mid-iteration with an `AbortError` (`ABORT_ERR`).
  // All probed head-to-head against real Node v24.

  /**
   * `readable.iterator({ destroyOnReturn })` — the async iterator with explicit
   * cleanup control. Default `destroyOnReturn:true` matches `[Symbol.asyncIterator]`
   * (an early `return()` destroys the source); `false` detaches the listeners but
   * leaves the stream undestroyed and resumable (Node parity).
   */
  iterator(options: { destroyOnReturn?: boolean } = {}): AsyncIterableIterator<unknown> {
    return this.createAsyncIterator(options.destroyOnReturn ?? true);
  }

  /**
   * `readable.wrap(stream)` (Node's streams1 adapter) — subscribe a legacy
   * (`'data'`/`'end'`) source and `push()` its chunks, honoring backpressure via
   * the legacy `pause()`/`resume()` (when `push()` reports the buffer is full we
   * pause the source; a drain or a `read()` resumes it). `'error'` on the legacy
   * source destroys this Readable. Returns `this`. Verified vs real Node v24.
   */
  wrap(stream: LegacyStreamSource): this {
    let paused = false;
    const resumeLegacy = (): void => {
      if (paused && typeof stream.resume === 'function') {
        paused = false;
        stream.resume();
      }
    };
    const onData = (chunk: unknown): void => {
      const more = this.push(chunk);
      if (more === false && !paused && typeof stream.pause === 'function') {
        paused = true;
        stream.pause();
      }
    };
    const onEnd = (): void => {
      this.push(null);
    };
    const onError = (err: unknown): void => {
      if (!this._readableState.destroyed) this.destroy(err as Error);
    };
    // A drain on our side (buffer fell below HWM in flowing mode) resumes the
    // legacy source.
    this.on('data', () => {
      if (this._readableState.length < this._readableState.highWaterMark) resumeLegacy();
    });
    // Install a `_read` so a paused-mode consumer's `read()` resumes the legacy
    // source (Node's wrap installs a `_read` that calls `stream.resume()`).
    this.readImpl = (): void => {
      resumeLegacy();
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    return this;
  }

  /** `readable.map(fn, opts?)` → object-mode Readable of mapped values (concurrency/signal aware). */
  map(fn: (value: unknown, index: number) => unknown, options?: AsyncHelperOptions): Readable {
    assertHelperFn(fn);
    const opts = validateHelperOptions(options);
    return Readable.from(mappedGenerator(this, fn, opts), { objectMode: true });
  }

  /** `readable.filter(fn, opts?)` → object-mode Readable keeping values where `fn` is truthy. */
  filter(fn: (value: unknown, index: number) => unknown, options?: AsyncHelperOptions): Readable {
    assertHelperFn(fn);
    const opts = validateHelperOptions(options);
    const KEEP = filterSentinel;
    const gen = mappedGenerator(
      this,
      async (value, index) => ((await fn(value, index)) ? value : KEEP),
      opts,
    );
    return Readable.from(droppingSentinel(gen, KEEP), { objectMode: true });
  }

  /** `readable.flatMap(fn, opts?)` → object-mode Readable flattening each mapped iterable. */
  flatMap(fn: (value: unknown, index: number) => unknown, options?: AsyncHelperOptions): Readable {
    assertHelperFn(fn);
    const opts = validateHelperOptions(options);
    return Readable.from(flatMappedGenerator(this, fn, opts), { objectMode: true });
  }

  /** `readable.take(n)` → object-mode Readable of the first `n` values. */
  take(count: number): Readable {
    assertCount(count);
    const source = this;
    async function* gen(): AsyncGenerator<unknown> {
      if (count <= 0) {
        // Honour early-termination cleanup of the source (destroy on return).
        const it = source[Symbol.asyncIterator]();
        await it.return?.();
        return;
      }
      let taken = 0;
      for await (const value of source) {
        yield value;
        if (++taken >= count) break;
      }
    }
    return Readable.from(gen(), { objectMode: true });
  }

  /** `readable.drop(n)` → object-mode Readable skipping the first `n` values. */
  drop(count: number): Readable {
    assertCount(count);
    const source = this;
    async function* gen(): AsyncGenerator<unknown> {
      let dropped = 0;
      for await (const value of source) {
        if (dropped < count) {
          dropped++;
          continue;
        }
        yield value;
      }
    }
    return Readable.from(gen(), { objectMode: true });
  }

  /** `readable.forEach(fn, opts?)` → Promise<void>; runs `fn` per value (concurrency/signal aware). */
  async forEach(
    fn: (value: unknown, index: number) => unknown,
    options?: AsyncHelperOptions,
  ): Promise<void> {
    assertHelperFn(fn);
    const opts = validateHelperOptions(options);
    // Drive the same ordered engine; discard outputs.
    for await (const _ of mappedGenerator(this, fn, opts)) {
      void _;
    }
  }

  /** `readable.toArray(opts?)` → Promise of all values as an array. */
  async toArray(options?: { signal?: AbortSignal }): Promise<unknown[]> {
    const signal = options?.signal;
    throwIfAborted(signal);
    const out: unknown[] = [];
    for await (const value of this) {
      throwIfAborted(signal);
      out.push(value);
    }
    return out;
  }

  /**
   * `readable.reduce(fn, initial?)` → Promise of the accumulated value. With no
   * `initial`, the first element seeds the accumulator; an EMPTY stream with no
   * `initial` rejects `ERR_MISSING_ARGS` (TypeError), exactly like Node.
   */
  async reduce(
    fn: (accumulator: unknown, value: unknown, index: number) => unknown,
    // Default to the `NO_INITIAL` sentinel (not `undefined`) so a caller passing
    // an explicit `undefined` initial is distinguished from omitting it — without
    // reading `arguments` (Node distinguishes the two).
    initial: unknown = noInitial,
    options?: { signal?: AbortSignal },
  ): Promise<unknown> {
    assertHelperFn(fn);
    const signal = options?.signal;
    throwIfAborted(signal);
    const hasInitial = initial !== noInitial;
    let acc = hasInitial ? initial : undefined;
    let seeded = hasInitial;
    let index = 0;
    for await (const value of this) {
      throwIfAborted(signal);
      if (!seeded) {
        acc = value;
        seeded = true;
        index++;
        continue;
      }
      acc = await fn(acc, value, index++);
    }
    if (!seeded) {
      const err = new TypeError(
        'Reduce of an empty stream requires an initial value',
      ) as TypeError & { code?: string };
      err.code = 'ERR_MISSING_ARGS';
      throw err;
    }
    return acc;
  }

  /** `readable.some(fn, opts?)` → Promise<boolean>; short-circuits on the first truthy. */
  async some(
    fn: (value: unknown, index: number) => unknown,
    options?: AsyncHelperOptions,
  ): Promise<boolean> {
    assertHelperFn(fn);
    const opts = validateHelperOptions(options);
    // A hit (truthy predicate) → `true`; no hit (sentinel) → `false`. Compare
    // against the sentinel, NOT `find`'s output (which maps the sentinel away).
    return (await firstMatch(this, fn, opts)) !== undefinedSentinel;
  }

  /** `readable.every(fn, opts?)` → Promise<boolean>; short-circuits on the first falsy. */
  async every(
    fn: (value: unknown, index: number) => unknown,
    options?: AsyncHelperOptions,
  ): Promise<boolean> {
    assertHelperFn(fn);
    const opts = validateHelperOptions(options);
    // `every(fn)` is `!some(!fn)`; reuse the ordered short-circuit engine.
    const failed = await firstMatch(this, async (v, i) => !(await fn(v, i)), opts);
    return failed === undefinedSentinel;
  }

  /**
   * `readable.find(fn, opts?)` → Promise of the first value where `fn` is truthy
   * (or `undefined`). Short-circuits.
   */
  async find(
    fn: (value: unknown, index: number) => unknown,
    options?: AsyncHelperOptions,
  ): Promise<unknown> {
    assertHelperFn(fn);
    const opts = validateHelperOptions(options);
    const hit = await firstMatch(this, fn, opts);
    return hit === undefinedSentinel ? undefined : hit;
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

    let pulling = false;
    let done = false;
    const r = new Readable({
      highWaterMark: options.highWaterMark,
      objectMode: resolvedMode,
      encoding: options.encoding,
      read(): void {
        void pump();
      },
    });

    const pump = async (): Promise<void> => {
      if (pulling || done || r.destroyed) return;
      pulling = true;
      try {
        while (!r.destroyed && r._readableState.length < r._readableState.highWaterMark) {
          let step: IteratorResult<unknown>;
          if (firstResult !== null) {
            step = firstResult as IteratorResult<unknown>;
            firstResult = null;
          } else if (isAsync) {
            step = await (iterator as AsyncIterator<unknown>).next();
          } else {
            step = (iterator as Iterator<unknown>).next();
          }
          if (step.done) {
            done = true;
            r.push(null);
            return;
          }
          if (!r.push(step.value)) return;
        }
      } catch (err) {
        r.destroy(err as Error);
      } finally {
        pulling = false;
      }
    };
    return r;
  }

  /**
   * Convert a WHATWG `ReadableStream` into this Node-shape `Readable`.
   *
   * The reader pump preserves each web-stream chunk boundary and stops reading
   * when `push()` reports backpressure, resuming only after the Node-readable
   * buffer has drained below its high-water mark.
   */
  static fromWeb(stream: ReadableStream<unknown>, options: ReadableFromWebOptions = {}): Readable {
    if (!stream || typeof (stream as { getReader?: unknown }).getReader !== 'function') {
      throw new TypeError(
        'Readable.fromWeb: the "readableStream" argument must be a ReadableStream',
      );
    }
    if (options.signal?.aborted) {
      const r = new Readable(options);
      queueMicrotask(() => r.destroy(abortError()));
      return r;
    }

    const reader = stream.getReader();
    const r = new Readable(options);
    let closed = false;

    // Abort→destroy wiring shared with `stream.addAbortSignal` (its `'close'`/
    // `'end'` cleanup detaches the listener; the pump no longer removes it).
    if (options.signal) addAbortSignal(options.signal, r);

    r.once('close', () => {
      if (closed) return;
      closed = true;
      void reader.cancel().catch(() => {});
    });

    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value === undefined) continue;
          const chunk =
            !r.readableObjectMode && typeof value === 'string' ? Buffer.from(value) : value;
          if (!r.push(chunk)) await waitForReadableDemand(r);
        }
        closed = true;
        reader.releaseLock();
        r.push(null);
      } catch (err) {
        closed = true;
        try {
          reader.releaseLock();
        } catch {
          /* already released/cancelled */
        }
        r.destroy(err as Error);
      }
    })();
    return r;
  }
}

export interface ReadableFromWebOptions extends ReadableOptions {
  signal?: AbortSignal;
}

/**
 * Minimal legacy (streams1) source shape `Readable.wrap` adapts: an event
 * emitter that emits `'data'`/`'end'`/`'error'` and (optionally) supports
 * `pause()`/`resume()` for backpressure.
 */
export interface LegacyStreamSource {
  on(event: 'data' | 'end' | 'error', listener: (...args: unknown[]) => void): unknown;
  pause?(): unknown;
  resume?(): unknown;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function waitForReadableDemand(r: Readable): Promise<void> {
  if (r.destroyed || r.readableLength < r.readableHighWaterMark) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      r.off('data', onProgress);
      r.off('readable', onProgress);
      r.off('end', onProgress);
      r.off('close', onClose);
      r.off('error', onError);
    };
    const done = (): void => {
      cleanup();
      resolve();
    };
    const onProgress = (): void => {
      if (r.destroyed || r.readableLength < r.readableHighWaterMark || r.readableEnded) done();
    };
    const onClose = (): void => {
      done();
    };
    const onError = (err: unknown): void => {
      cleanup();
      reject(err);
    };
    r.on('data', onProgress);
    r.on('readable', onProgress);
    r.on('end', onProgress);
    r.on('close', onClose);
    r.on('error', onError);
    queueMicrotask(onProgress);
  });
}

/** Minimal shape `addAbortSignal` drives: anything with Node's `destroy(err)`. */
interface AbortableStream {
  destroy(err?: Error): unknown;
  once(event: 'close' | 'end', listener: () => void): unknown;
  off(event: 'close' | 'end', listener: () => void): unknown;
}

/**
 * `stream.addAbortSignal(signal, stream)` (Node v15.4) — destroy `stream` with
 * an `AbortError` (`code:'ABORT_ERR'`) when `signal` aborts; an already-aborted
 * signal destroys synchronously, matching Node's immediate branch.
 * Returns `stream`. The abort listener is detached when the stream finishes
 * (`'close'` or `'end'`) so it does not leak.
 *
 * Extracted from `Readable.fromWeb`'s inline abort wiring (which now reuses it).
 */
export function addAbortSignal<T extends AbortableStream>(signal: AbortSignal, stream: T): T {
  if (signal.aborted) {
    stream.destroy(abortError());
    return stream;
  }
  const onAbort = (): void => {
    stream.destroy(abortError());
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const cleanup = (): void => {
    signal.removeEventListener('abort', onAbort);
  };
  stream.once('close', cleanup);
  stream.once('end', cleanup);
  return stream;
}

// ─────────────────── async-iterator helper machinery ────────────────────────
// Shared by `Readable.prototype.{map,filter,flatMap,forEach,some,every,find}`.

/** `{ concurrency, signal }` accepted by the concurrent helpers. */
export interface AsyncHelperOptions {
  /** Max in-flight callbacks (default 1). Output stays in INPUT order regardless. */
  concurrency?: number;
  /** Abort mid-iteration → reject with an `AbortError` (`code:'ABORT_ERR'`). */
  signal?: AbortSignal;
}

interface ResolvedHelperOptions {
  concurrency: number;
  signal?: AbortSignal;
}

/**
 * Unique markers (never collide with user data): `filterSentinel` flags a
 * filtered-out value inside the shared map engine; `undefinedSentinel` is the
 * "no match" result for `find`/`some`/`every` (so a genuine `undefined` value
 * found by `find` is distinguishable from "not found"). Frozen objects, never
 * exposed.
 */
const filterSentinel: unique symbol = Symbol('rifty/io:filtered-out');
const undefinedSentinel: unique symbol = Symbol('rifty/io:no-match');
/** `reduce`'s "no initial value provided" marker (distinct from `undefined`). */
const noInitial: unique symbol = Symbol('rifty/io:no-initial');

/** Node's `ERR_INVALID_ARG_TYPE` for a non-function helper callback (sync throw). */
function assertHelperFn(fn: unknown): asserts fn is (...args: never[]) => unknown {
  if (typeof fn !== 'function') {
    const err = new TypeError(
      `The "fn" argument must be of type function. Received ${fn === null ? 'null' : typeof fn}`,
    ) as TypeError & { code?: string };
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
  }
}

/** Node's `ERR_OUT_OF_RANGE` (RangeError) for a bad `take`/`drop` count (sync throw). */
function assertCount(count: number): void {
  if (typeof count !== 'number' || Number.isNaN(count) || count < 0) {
    const err = new RangeError(
      `The value of "number" is out of range. It must be a non-negative number. Received ${String(count)}`,
    ) as RangeError & { code?: string };
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
}

/**
 * Validate `{ concurrency, signal }`. `concurrency` must be a number `> 0`
 * (1.5 accepted; 0/-1/'x' → `ERR_OUT_OF_RANGE`, RangeError — sync throw, Node
 * parity). Returns the resolved options (default concurrency 1).
 */
function validateHelperOptions(options?: AsyncHelperOptions): ResolvedHelperOptions {
  const concurrency = options?.concurrency ?? 1;
  if (typeof concurrency !== 'number' || Number.isNaN(concurrency) || concurrency <= 0) {
    const err = new RangeError(
      `The value of "concurrency" is out of range. It must be a positive number. Received ${String(concurrency)}`,
    ) as RangeError & { code?: string };
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
  return { concurrency, signal: options?.signal };
}

/** Throw the `AbortError` (`ABORT_ERR`) if the signal is aborted. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Ordered concurrency engine for `map`/`filter`/`forEach`. Pulls from `source`
 * up to `concurrency` callbacks in flight, but YIELDS results in INPUT order
 * (the mandatory guarantee): result for input #i is yielded only once its
 * callback settles, while the window stays full of later inputs. A callback
 * throw (or a signal abort) fails fast — the in-flight work is abandoned and the
 * error propagates on the next `next()`.
 *
 * `filter` passes a wrapper that resolves to `filterSentinel` for dropped
 * values; the caller strips them via {@link droppingSentinel} (so the drop still
 * happens in order, after the concurrent predicate resolves).
 */
async function* mappedGenerator(
  source: Readable,
  fn: (value: unknown, index: number) => unknown,
  opts: ResolvedHelperOptions,
): AsyncGenerator<unknown> {
  const { concurrency, signal } = opts;
  throwIfAborted(signal);
  const iterator = source[Symbol.asyncIterator]();

  // Abort handle: a never-resolving promise that rejects with the AbortError the
  // moment the signal fires, so an in-flight head await unblocks immediately.
  let abortListener: (() => void) | null = null;
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        if (signal.aborted) reject(abortError());
        else {
          abortListener = (): void => reject(abortError());
          signal.addEventListener('abort', abortListener, { once: true });
        }
      })
    : null;
  abortPromise?.catch(() => {}); // never an unhandled rejection on the clean path

  const cleanup = async (): Promise<void> => {
    if (abortListener && signal) signal.removeEventListener('abort', abortListener);
    await iterator.return?.();
  };

  // The pool keeps up to `concurrency` callbacks in flight. Each in-flight task
  // settles to `{ index, value }`; we buffer settled results by index and yield
  // them in INPUT order, refilling a slot the instant ANY task settles (Node
  // starts the next input on a peer's COMPLETION, not on the head's yield).
  //
  // CRUCIAL: each task's promise resolves to its OWN tag and is removed from the
  // pool only inside the race loop (by identity), so a result is never dropped —
  // a settled-but-unraced promise (e.g. a SYNCHRONOUS `fn` whose promise settles
  // during a `fillPool`) is still pending in the pool until the race consumes it.
  interface Settled {
    readonly index: number;
    readonly value: unknown;
    readonly self: Promise<Settled>;
  }
  const pool = new Set<Promise<Settled>>();
  const ready = new Map<number, unknown>();
  let inputIndex = 0;
  let nextToYield = 0;
  let sourceDone = false;

  const spawn = (value: unknown, index: number): void => {
    const self: Promise<Settled> = Promise.resolve(fn(value, index)).then((mapped) => ({
      index,
      value: mapped,
      self,
    }));
    pool.add(self);
  };

  // Pull inputs until the pool is full or the source is exhausted. Racing the
  // abort means a slow `iterator.next()` still unblocks on abort.
  const fillPool = async (): Promise<void> => {
    while (!sourceDone && pool.size < concurrency) {
      const step = await (abortPromise
        ? Promise.race([iterator.next(), abortPromise])
        : iterator.next());
      if (step.done) {
        sourceDone = true;
        return;
      }
      spawn(step.value, inputIndex++);
    }
  };

  try {
    throwIfAborted(signal);
    await fillPool();
    while (pool.size > 0 || ready.has(nextToYield)) {
      // Emit every in-order result already buffered, refilling the freed slots.
      while (ready.has(nextToYield)) {
        const value = ready.get(nextToYield);
        ready.delete(nextToYield);
        nextToYield++;
        yield value;
        await fillPool();
      }
      if (pool.size === 0) break;
      // Wait for the next task to settle (any of them); remove exactly that
      // promise from the pool, buffer its result, and refill — mirroring Node's
      // complete-then-pull ordering.
      const settled = await (abortPromise
        ? Promise.race([Promise.race(pool), abortPromise])
        : Promise.race(pool));
      pool.delete(settled.self);
      ready.set(settled.index, settled.value);
      await fillPool();
    }
  } finally {
    await cleanup();
  }
}

/** Strip `filterSentinel` markers from a generator's output (order-preserving). */
async function* droppingSentinel(
  gen: AsyncGenerator<unknown>,
  sentinel: symbol,
): AsyncGenerator<unknown> {
  for await (const value of gen) {
    if (value !== sentinel) yield value;
  }
}

/**
 * `flatMap` engine: map each input through `fn` (concurrency/signal aware, input
 * order), then flatten each result. A returned iterable/async-iterable is spread
 * in order; a scalar is yielded as-is (Node flattens one level).
 */
async function* flatMappedGenerator(
  source: Readable,
  fn: (value: unknown, index: number) => unknown,
  opts: ResolvedHelperOptions,
): AsyncGenerator<unknown> {
  for await (const mapped of mappedGenerator(source, fn, opts)) {
    if (mapped != null && typeof mapped === 'object') {
      const asyncIt = (mapped as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
      const syncIt = (mapped as { [Symbol.iterator]?: unknown })[Symbol.iterator];
      if (typeof asyncIt === 'function' || typeof syncIt === 'function') {
        for await (const sub of mapped as AsyncIterable<unknown> | Iterable<unknown>) yield sub;
        continue;
      }
    }
    yield mapped;
  }
}

/**
 * Shared short-circuit driver for `find`/`some`/`every`: return the first value
 * whose `predicate` resolves truthy (concurrency/signal aware, input order), or
 * {@link undefinedSentinel} if none. Stops pulling the source once a hit is
 * found (and destroys it via the iterator's `return`).
 */
async function firstMatch(
  source: Readable,
  predicate: (value: unknown, index: number) => unknown,
  opts: ResolvedHelperOptions,
): Promise<unknown> {
  // Reuse the ordered map engine: map each value to `{ hit, value }`, then scan
  // in order for the first hit. Concurrency still runs the predicate ahead, but
  // the FIRST in-order hit wins (matches Node's documented order).
  const tagged = mappedGenerator(
    source,
    async (value, index) => ({ hit: Boolean(await predicate(value, index)), value }),
    opts,
  );
  for await (const entry of tagged) {
    const { hit, value } = entry as { hit: boolean; value: unknown };
    if (hit) {
      await tagged.return?.(undefined);
      return value;
    }
  }
  return undefinedSentinel;
}
