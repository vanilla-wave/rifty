/**
 * Node-compatible `node:stream.Writable` — owned by `@riftydev/io` per ADR-0012.
 *
 * Buffered write / `_write` / `_final` lifecycle plus `drain` when the buffer
 * falls below the high-water mark.
 *
 * Per ADR-0034, all state lives in `_writableState` (Node convention;
 * downstream callers inspect `w._writableState.{destroyed,ended,finished,length}`).
 * Fields mirror Node's `internal/streams/state.js`.
 */

import { Buffer, type Encoding } from '../buffer.ts';
import { EventEmitter } from '../event-emitter.ts';
import {
  type CallableStreamConstructor,
  initializeWritable,
  makeCallableStreamConstructor,
} from './callable-constructor.ts';
import { acquireWritableFromWeb } from './from-web-validation.ts';
import { chunkSize } from './readable.ts';

export interface WritableOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  decodeStrings?: boolean;
  write?(this: Writable, chunk: unknown, encoding: string, cb: (err?: Error | null) => void): void;
  /**
   * Batched write. WIRED FOR REAL (not the removed type-only lie): when a
   * cork/uncork flush — or a pile-up while a prior write is in flight — produces
   * 2+ buffered chunks, they are delivered to `_writev` in ONE call as a
   * `[{ chunk, encoding }, …]` array (Node shape). Accepted ONLY because it is
   * honored; a single buffered chunk still routes to `_write`.
   */
  writev?(this: Writable, chunks: WriteChunk[], cb: (err?: Error | null) => void): void;
  final?(this: Writable, cb: (err?: Error | null) => void): void;
}

export interface WritableFromWebOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  decodeStrings?: boolean;
}

/** A buffered write as handed to `_writev` (Node's `{ chunk, encoding }` shape). */
export interface WriteChunk {
  chunk: unknown;
  encoding: string;
}

/**
 * Structural Writable shape `Writable.toWeb` drives — anything with Node's
 * `write`/`end`/`destroy` + the `'drain'`/`'finish'`/`'error'` event surface. A
 * `Duplex` qualifies (it delegates those to its writable side) without being an
 * `instanceof Writable`, so `Duplex.toWeb` can reuse `Writable.toWeb(d)`.
 */
export interface WritableLike {
  write(chunk: unknown, ...rest: unknown[]): boolean;
  end(...args: unknown[]): unknown;
  destroy(err?: Error): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  readonly destroyed: boolean;
}

interface BufferedWrite {
  chunk: unknown;
  encoding: string;
  cb: (err?: Error | null) => void;
}

type EndCallback = (error?: Error | null) => void;

/**
 * Per-instance state bag per Node's `_writableState` convention. Field names
 * mirror Node's `internal/streams/state.js`; only fields rifty's tests or
 * downstream callers read/write are surfaced.
 */
export interface WritableState {
  buffered: BufferedWrite[];
  /** Total byte (or entry, object mode) count across `buffered`. */
  length: number;
  highWaterMark: number;
  objectMode: boolean;
  /** Node coerces every constructor value except literal `false` to enabled. */
  decodeStrings: boolean;
  /** Re-entrancy guard while a chunk is being flushed via `_write`. */
  writing: boolean;
  /** A `_final` hook is running or has published its result. */
  finalizing: boolean;
  /** `true` once `.end()` has been called. */
  ending: boolean;
  /** `true` after `_final` has resolved (or no `_final` and the queue drained). */
  finished: boolean;
  /** `true` once explicit destroy or natural auto-close starts. */
  destroyed: boolean;
  /** `true` once the terminal `'close'` event is published. */
  closed: boolean;
  /** Error from `destroy(err)` if any. */
  errored: Error | null;
  /**
   * Whether a `'drain'` is owed. Node fires `'drain'` only after a prior
   * `write()` returned `false` (buffer hit HWM); a dip below HWM after a write
   * that returned `true` must NOT emit it.
   */
  needDrain: boolean;
  /**
   * Nested-cork counter (Node's `corked`, surfaced as `writableCorked`). While
   * `> 0`, `write()` buffers but does NOT drain; `uncork()` decrements and the
   * buffer is flushed only when it returns to 0. `end()` clears it (end implies
   * a final flush).
   */
  corked: number;
  /**
   * Coalescing flag: at most one `drainBuffer()` microtask is pending at a
   * time. N writes in one tick schedule one turn, not N (the drain loop then
   * processes synchronously-completing chunks in the same tick).
   */
  drainScheduled: boolean;
  /** True when the next flush may batch buffered chunks through `_writev`. */
  writevBatch: boolean;
}

function unknownEncodingError(encoding: string): TypeError & { code: string } {
  const error = new TypeError(`Unknown encoding: ${encoding}`) as TypeError & { code: string };
  error.code = 'ERR_UNKNOWN_ENCODING';
  return error;
}

export function streamDestroyedError(): Error & { code: string } {
  const error = new Error('Cannot call end after a stream was destroyed') as Error & {
    code: string;
  };
  error.code = 'ERR_STREAM_DESTROYED';
  return error;
}

function streamAlreadyFinishedError(): Error & { code: string } {
  const error = new Error('Calling end() after a stream was finished') as Error & {
    code: string;
  };
  error.code = 'ERR_STREAM_ALREADY_FINISHED';
  return error;
}

function admitWrite(
  state: WritableState,
  chunk: unknown,
  encoding: string,
): { chunk: unknown; encoding: string } {
  if (state.objectMode) return { chunk, encoding };
  if (!Buffer.isEncoding(encoding)) throw unknownEncodingError(encoding);
  if (typeof chunk === 'string') {
    return state.decodeStrings
      ? { chunk: Buffer.from(chunk, encoding.toLowerCase() as Encoding), encoding: 'buffer' }
      : { chunk, encoding };
  }
  if (Buffer.isBuffer(chunk)) return { chunk, encoding: 'buffer' };
  if (chunk instanceof Uint8Array) {
    return {
      chunk: new Buffer(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength),
      encoding: 'buffer',
    };
  }
  return { chunk, encoding };
}

class WritableImplementation extends EventEmitter {
  readonly _writableState!: WritableState;
  private writeImpl?: (
    this: Writable,
    chunk: unknown,
    encoding: string,
    cb: (err?: Error | null) => void,
  ) => void;
  private writevImpl?: (
    this: Writable,
    chunks: WriteChunk[],
    cb: (err?: Error | null) => void,
  ) => void;
  private finalImpl?: (this: Writable, cb: (err?: Error | null) => void) => void;
  private readonly endCallbacks!: EndCallback[];

  constructor(opts: WritableOptions = {}) {
    super();
    initializeWritable(this as unknown as Writable, opts);
  }

  _write(_chunk: unknown, _encoding: string, cb: (err?: Error | null) => void): void {
    cb();
  }

  /**
   * Batched-write hook. DELIBERATELY no base implementation (declared optional)
   * — like Node, `_writev` is absent unless a subclass defines it, and the drain
   * loop only batches via `_writev` when it is present (a single buffered chunk
   * always routes to `_write`). A subclass assigns it as a prototype method.
   */
  _writev?(chunks: WriteChunk[], cb: (err?: Error | null) => void): void;

  _final(cb: (err?: Error | null) => void): void {
    cb();
  }

  get writable(): boolean {
    const state = this._writableState;
    return !state.destroyed && !state.ending && !state.finished;
  }

  get writableHighWaterMark(): number {
    return this._writableState.highWaterMark;
  }

  get writableObjectMode(): boolean {
    return this._writableState.objectMode;
  }

  get writableLength(): number {
    return this._writableState.length;
  }

  get writableEnded(): boolean {
    return this._writableState.ending;
  }

  get writableFinished(): boolean {
    return this._writableState.finished;
  }

  get destroyed(): boolean {
    return this._writableState.destroyed;
  }

  get closed(): boolean {
    return this._writableState.closed;
  }

  /** Node's `writableCorked` — the current nested-cork depth. */
  get writableCorked(): number {
    return this._writableState.corked;
  }

  /**
   * `cork()` — force subsequent writes to buffer (no `_write`/`_writev`) until a
   * matching `uncork()` (or `end()`). Nested: each `cork()` must be balanced by
   * an `uncork()`; the buffer flushes only when the counter returns to 0.
   */
  cork(): void {
    this._writableState.corked += 1;
  }

  /**
   * `uncork()` — undo one `cork()`. When the cork counter reaches 0 (and a
   * `_write` is not already in flight) the buffered chunks flush immediately,
   * batched via `_writev` when 2+ are pending. Matches Node's synchronous
   * `clearBuffer` on the final uncork.
   */
  uncork(): void {
    const state = this._writableState;
    if (state.corked > 0) state.corked -= 1;
    // Flush synchronously on the final uncork (Node semantics) — not via a
    // microtask, so a `write()` after `uncork()` in the same tick starts a
    // fresh batch rather than joining this one.
    if (state.corked === 0 && !state.writing && state.buffered.length > 0) {
      state.writevBatch = true;
      this.drainBuffer();
    }
  }

  /**
   * Schedule one `drainBuffer()` microtask, coalescing repeats. Multiple
   * write()/end() calls in a single tick enqueue at most one turn; the drain
   * loop then advances through synchronously-completing chunks in-tick.
   */
  private scheduleDrain(): void {
    const state = this._writableState;
    if (state.drainScheduled) return;
    state.drainScheduled = true;
    queueMicrotask(() => {
      state.drainScheduled = false;
      this.drainBuffer();
    });
  }

  write(
    chunk: unknown,
    encodingOrCb?: string | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean {
    const state = this._writableState;
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8';
    const cbFinal = (typeof encodingOrCb === 'function' ? encodingOrCb : cb) ?? (() => {});
    // Node contract after destroy/end/finished: sync return false, cb errors next tick.
    if (state.destroyed || state.errored) {
      const err = state.errored ?? new Error('Cannot call write after a stream was destroyed');
      queueMicrotask(() => cbFinal(err));
      return false;
    }
    if (state.ending || state.finished) {
      const err = new Error('write after end');
      queueMicrotask(() => {
        cbFinal(err);
        // Match Node: emit so unattended writes-after-end surface.
        if (this.listenerCount('error') > 0) this.emit('error', err);
      });
      return false;
    }
    const admitted = admitWrite(state, chunk, encoding);
    state.buffered.push({ ...admitted, cb: cbFinal });
    state.length += state.objectMode ? 1 : chunkSize(admitted.chunk);
    if (state.writing && state.corked === 0) state.writevBatch = true;
    // Node dispatches the first uncorked write on the caller's stack. A
    // synchronous callback can therefore clear length before write() computes
    // its return value; re-entrant writes stay buffered behind `state.writing`.
    if (state.corked === 0) {
      if (state.writing) this.scheduleDrain();
      else this.drainBuffer();
    }
    const okToContinue =
      !state.destroyed &&
      !state.errored &&
      (state.length === 0 || state.length < state.highWaterMark);
    // Hit HWM: owe a 'drain' for the next dip below it. Don't clear once set.
    if (!okToContinue && !state.destroyed && !state.errored) state.needDrain = true;
    return okToContinue;
  }

  private publishWriteCompletion(
    entries: readonly BufferedWrite[],
    error: Error | null | undefined,
    synchronous: boolean,
    destroyAfterError: boolean,
  ): void {
    const publish = (): void => {
      const state = this._writableState;
      if (!error && state.needDrain && (state.length === 0 || state.length < state.highWaterMark)) {
        state.needDrain = false;
        this.emit('drain');
      }
      for (const entry of entries) entry.cb(error);
      if (error && destroyAfterError && !state.destroyed) {
        this.publishEndCallbacks(error);
        this.destroy(error);
      }
    };
    if (synchronous) queueMicrotask(publish);
    else publish();
  }

  private drainBuffer(): void {
    const state = this._writableState;
    if (state.writing) return;
    if (state.errored && !state.destroyed) return;
    // While corked, hold everything — only `uncork()` (count→0) or `end()`
    // releases the buffer. A stray scheduled drain mustn't flush a corked
    // stream (Node never calls `clearBuffer` while `corked > 0`).
    if (state.corked > 0) return;
    // Sync-drain loop: process buffered chunks whose `_write` completes
    // synchronously in this same tick (collapsing the old one-chunk-per-
    // microtask chain). Break the moment a chunk's `done` is deferred (async
    // `_write`) — that `done` re-arms via scheduleDrain(); or on error/destroy.
    while (true) {
      // Post-destroy: error every pending callback synchronously and bail.
      if (state.destroyed) {
        const err = state.errored ?? new Error('Premature close');
        const queue = state.buffered.slice();
        state.buffered.length = 0;
        state.length = 0;
        for (const entry of queue) entry.cb(err);
        return;
      }
      if (state.buffered.length === 0) {
        if (state.ending && !state.finished && !state.errored) this.doFinal();
        return;
      }
      // `_writev` path (Node's `doWrite` writev branch): use it when present AND
      // either 2+ chunks are buffered, OR there is no real `_write` (then
      // `_writev` IS the write impl, even for a single chunk). With a real
      // `_write`, a single buffered chunk routes to `_write` below. The batch is
      // the loop's terminal action this pass (its `done` advances/re-arms).
      const writev = this.resolveWritev();
      const canBatch = state.writevBatch && state.buffered.length > 1;
      if (writev && (canBatch || !this.hasRealWrite())) {
        state.writevBatch = false;
        if (this.flushViaWritev(writev)) continue;
        return;
      }
      const next = state.buffered.shift();
      if (!next) {
        if (state.ending && !state.finished && !state.errored) this.doFinal();
        return;
      }
      state.writing = true;
      const nextSize = state.objectMode ? 1 : chunkSize(next.chunk);
      // `true` only while `_write` runs synchronously — lets `done` tell sync
      // from async completion. A sync `done` leaves the loop to advance; an
      // async `done` (called after `writeImpl` returns) re-arms scheduleDrain().
      let inSyncWrite = true;
      // Set by `done` when the loop may advance to the next chunk in-tick
      // (success path, sync completion). Error/destroy leave it false so the
      // loop stops, matching the old one-shot-then-return behaviour.
      let mayContinueSync = false;
      const done = (err?: Error | null): void => {
        state.writing = false;
        // Destroyed during the `_write`: skip success path; this entry's cb gets
        // the destroy error, the rest drain via the destroyed-branch next pass.
        if (state.destroyed) {
          if (err && !state.errored) state.errored = err;
          this.publishWriteCompletion([next], err ?? null, inSyncWrite, false);
          return;
        }
        state.length -= nextSize;
        if (err) {
          state.errored = err;
          this.publishWriteCompletion(this.takeErroredWrites([next]), err, inSyncWrite, true);
          return;
        }
        if (inSyncWrite) {
          this.publishWriteCompletion([next], undefined, true, false);
          mayContinueSync = true;
        } else {
          // Node advances an already-buffered successor on the completing
          // callback's stack, then publishes drain/callback for this entry.
          this.drainBuffer();
          this.publishWriteCompletion([next], undefined, false, false);
        }
      };
      const writeImpl = this.writeImpl ?? this._write;
      writeImpl.call(this, next.chunk, next.encoding, done);
      inSyncWrite = false;
      // Continue only on a clean synchronous completion; stop on async-pending
      // (`done` deferred → re-arms via scheduleDrain), error, or destroy.
      if (!mayContinueSync) return;
    }
  }

  /**
   * The batched-write implementation, if one exists: the `{ writev }` ctor
   * option, else a subclass-defined `_writev` method (the base class has none —
   * so `this._writev` is truthy only when a subclass overrode it, exactly like
   * Node gating `clearBuffer` on `stream._writev`).
   */
  private resolveWritev():
    | ((this: Writable, chunks: WriteChunk[], cb: (err?: Error | null) => void) => void)
    | undefined {
    if (this.writevImpl) return this.writevImpl;
    return typeof this._writev === 'function' ? this._writev : undefined;
  }

  /**
   * Whether a REAL `_write` exists — the `{ write }` ctor option or a subclass
   * `_write` override (NOT the base no-op). When false and a `_writev` exists,
   * `_writev` is the write impl and a single buffered chunk routes through it
   * (matches Node, which uses `_writev` whenever `_write` is not provided).
   */
  private hasRealWrite(): boolean {
    return this.writeImpl !== undefined || this._write !== Writable.prototype._write;
  }

  /**
   * Flush ALL currently-buffered chunks through `_writev` in one call. Mirrors
   * the single-write `done` contract for the whole batch: on success every
   * entry's callback fires and a `'drain'` is emitted if owed; an error (or a
   * `destroy` during the write) errors every batched callback and destroys the
   * stream. Returns `true` iff the batch completed synchronously and cleanly
   * (the drain loop may continue); `false` on async-pending / error / destroy.
   */
  private flushViaWritev(
    writev: (this: Writable, chunks: WriteChunk[], cb: (err?: Error | null) => void) => void,
  ): boolean {
    const state = this._writableState;
    const batch = state.buffered.slice();
    state.buffered.length = 0;
    let removed = 0;
    for (const entry of batch) removed += state.objectMode ? 1 : chunkSize(entry.chunk);
    const chunks: WriteChunk[] = batch.map((e) => ({ chunk: e.chunk, encoding: e.encoding }));

    state.writing = true;
    let inSyncWrite = true;
    let mayContinueSync = false;
    const done = (err?: Error | null): void => {
      state.writing = false;
      if (state.destroyed) {
        if (err && !state.errored) state.errored = err;
        this.publishWriteCompletion(batch, err ?? null, inSyncWrite, false);
        return;
      }
      state.length -= removed;
      if (err) {
        state.errored = err;
        this.publishWriteCompletion(this.takeErroredWrites(batch), err, inSyncWrite, true);
        return;
      }
      if (inSyncWrite) {
        this.publishWriteCompletion(batch, undefined, true, false);
        mayContinueSync = true;
      } else {
        this.drainBuffer();
        this.publishWriteCompletion(batch, undefined, false, false);
      }
    };
    writev.call(this, chunks, done);
    inSyncWrite = false;
    return mayContinueSync;
  }

  private takeErroredWrites(inFlight: readonly BufferedWrite[]): BufferedWrite[] {
    const state = this._writableState;
    const queued = state.buffered.splice(0);
    state.length = 0;
    state.writevBatch = false;
    return [...inFlight, ...queued];
  }

  private publishEndCallbacks(error: Error | null): void {
    while (this.endCallbacks.length > 0) this.endCallbacks.shift()?.(error);
  }

  end(cb?: EndCallback): this;
  end(chunk: unknown, cb?: EndCallback): this;
  end(chunk: unknown, encoding?: string, cb?: EndCallback): this;
  end(chunkOrCb?: unknown, encodingOrCb?: string | EndCallback, cb?: EndCallback): this {
    const state = this._writableState;
    // end() implies an uncork: drop any outstanding cork depth so the buffered
    // chunks flush (Node clears `corked` on end).
    if (state.corked > 0 && state.buffered.length > 0) state.writevBatch = true;
    state.corked = 0;
    let cbFinal: EndCallback | undefined;
    if (typeof chunkOrCb === 'function') {
      cbFinal = chunkOrCb as EndCallback;
    } else if (chunkOrCb !== undefined) {
      this.write(chunkOrCb, typeof encodingOrCb === 'string' ? encodingOrCb : undefined);
      cbFinal = (typeof encodingOrCb === 'function' ? encodingOrCb : cb) as EndCallback | undefined;
    } else {
      cbFinal = typeof encodingOrCb === 'function' ? (encodingOrCb as EndCallback) : cb;
    }
    if (cbFinal) {
      if (state.finished) {
        queueMicrotask(() => cbFinal(streamAlreadyFinishedError()));
      } else if (state.destroyed) {
        if (state.errored) {
          const publish = (): void => cbFinal(streamDestroyedError());
          if (state.closed) queueMicrotask(publish);
          else this.once('close', publish);
        }
        return this;
      } else {
        this.endCallbacks.push(cbFinal);
      }
    }
    state.ending = true;
    if (state.writing) this.scheduleDrain();
    else this.drainBuffer();
    return this;
  }

  private doFinal(): void {
    const state = this._writableState;
    if (state.destroyed || state.errored || state.finished || state.finalizing) return;
    state.finalizing = true;
    let inSyncFinal = true;
    const finalize = (err?: Error | null): void => {
      if (state.destroyed || state.closed || state.finished) return;
      if (err) {
        state.errored = err;
        if (inSyncFinal) queueMicrotask(() => this.destroyInternal(err, true));
        else {
          this.publishEndCallbacks(err);
          this.destroy(err);
        }
      } else {
        this.emit('prefinish');
        queueMicrotask(() => {
          if (state.destroyed || state.errored || state.finished) return;
          state.finished = true;
          this.publishEndCallbacks(null);
          this.emit('finish');
          if (state.destroyed || state.closed) return;
          state.destroyed = true;
          state.closed = true;
          this.emit('close');
        });
      }
    };
    const finalImpl = this.finalImpl ?? this._final;
    finalImpl.call(this, finalize);
    inSyncFinal = false;
  }

  destroy(err?: Error): this {
    return this.destroyInternal(err, false);
  }

  private destroyInternal(err: Error | undefined, endCallbacksAfterClose: boolean): this {
    const state = this._writableState;
    if (state.destroyed) return this;
    state.destroyed = true;
    if (err) state.errored = err;
    // Subclass-style hook (used by `Writable.fromWeb`): abort the underlying web
    // writer with the destroy reason BEFORE the queued callbacks error, so the
    // web sink's `abort(reason)` sees the same error object.
    this.onDestroy?.(err);
    // Error queued writes' callbacks. Can't cancel the chunk currently in
    // `_write` (already running on the user's stack), but its `done` closure
    // checks `state.destroyed` before emitting drain/finish.
    const queue = state.buffered.slice();
    state.buffered.length = 0;
    state.length = 0;
    const destroyErr = err ?? streamDestroyedError();
    queueMicrotask(() => {
      for (const entry of queue) entry.cb(destroyErr);
      if (!endCallbacksAfterClose) this.publishEndCallbacks(destroyErr);
      // Match Node: emit error (if any) then close on the next tick.
      if (err) this.emit('error', err);
      if (!state.closed) {
        state.closed = true;
        this.emit('close');
      }
      if (endCallbacksAfterClose) this.publishEndCallbacks(destroyErr);
    });
    return this;
  }

  /**
   * Optional teardown hook invoked synchronously by {@link destroy} before the
   * queued callbacks error. `Writable.fromWeb` assigns it to abort the held web
   * writer; the base class leaves it unset (Node's `_destroy`, minus the public
   * surface we don't yet claim). NOT a public override point outside this
   * package — it's only wired internally.
   */
  protected onDestroy?: (err?: Error) => void;

  /**
   * Convert a WHATWG `WritableStream` into this Node-shape `Writable`
   * (Node's `Writable.fromWeb`, v17).
   *
   * `_write` pumps each chunk to a held web writer and awaits its promise (so a
   * slow web sink applies backpressure through the Node write callback); `_final`
   * → `writer.close()`. Terminal reason/order, one-sided teardown, settlement,
   * locks, and signal behavior remain tracked separately.
   */
  static fromWeb(stream: WritableStream<unknown>, options: WritableFromWebOptions = {}): Writable {
    const { writer, config } = acquireWritableFromWeb(stream, options);
    let aborted = false;
    const w = new Writable({
      highWaterMark: config.highWaterMark,
      objectMode: config.objectMode,
      decodeStrings: config.decodeStrings,
      write(chunk, _encoding, cb): void {
        writer.write(chunk).then(
          () => cb(),
          (err) => cb(err as Error),
        );
      },
      final(cb): void {
        writer.close().then(
          () => cb(),
          (err) => cb(err as Error),
        );
      },
    });
    // Start web abort on destroy. Exact terminal identity/order is backlogged;
    // `aborted` prevents a second abort from writer.closed.
    w.onDestroy = (err?: Error): void => {
      if (aborted) return;
      aborted = true;
      void writer.abort(err).catch(() => {});
    };
    // Web side erroring (`controller.error`) rejects the writer's `closed`. Mirror
    // it onto the Node writable: destroy with that error so `'error'` fires and
    // `destroyed` flips. The abort hook is short-circuited via `aborted`.
    writer.closed.catch((err: unknown) => {
      aborted = true;
      if (!w.destroyed) w.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    return w;
  }

  /**
   * Convert this Node-shape `Writable` into a WHATWG `WritableStream`
   * (Node's `Writable.toWeb`, v17).
   *
   * Each web `write(chunk)` calls `w.write(chunk)` and, when that returns `false`
   * (HWM hit), AWAITS the next `'drain'` before resolving — so the web writer's
   * promise stays pending (and the next chunk's `_write` is not reached) until
   * the Node side has capacity. `close()` → `w.end()` then await `'finish'`;
   * `abort(reason)` → `w.destroy(reason)`. `w` erroring → `controller.error(err)`
   * (the writer's `closed` rejects). Verified vs real Node v24.
   */
  static toWeb(streamWritable: WritableLike): WritableStream<unknown> {
    const w = streamWritable;
    let errored: Error | null = null;
    let finished = false;
    let controllerRef: WritableStreamDefaultController | null = null;
    // `w` erroring at any time errors the WHATWG controller (rejecting the
    // writer's `closed`). Wired once; a pre-existing error is replayed in start.
    w.on('error', (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      errored = e;
      controllerRef?.error(e);
    });
    w.on('finish', () => {
      finished = true;
    });
    w.on('close', () => {
      if (finished || errored) return;
      errored = abortError();
      controllerRef?.error(errored);
    });

    return new WritableStream<unknown>({
      start(controller): void {
        controllerRef = controller;
        if (errored) controller.error(errored);
      },
      write(chunk): Promise<void> | void {
        if (errored) return Promise.reject(errored);
        // Drain-gated: resolve immediately on a `true` return; otherwise await the
        // next `'drain'` (or an `'error'`) so the writer's promise serializes
        // exactly one chunk's worth of backpressure.
        const ok = w.write(chunk);
        if (ok) return;
        return new Promise<void>((resolve, reject) => {
          const onDrain = (): void => {
            cleanup();
            resolve();
          };
          const onError = (err: unknown): void => {
            cleanup();
            reject(err);
          };
          const onClose = (): void => {
            cleanup();
            reject(errored ?? abortError());
          };
          const cleanup = (): void => {
            w.off('drain', onDrain);
            w.off('error', onError);
            w.off('close', onClose);
          };
          w.on('drain', onDrain);
          w.on('error', onError);
          w.on('close', onClose);
        });
      },
      close(): Promise<void> | void {
        if (errored) return Promise.reject(errored);
        return new Promise<void>((resolve, reject) => {
          const onFinish = (): void => {
            cleanup();
            resolve();
          };
          const onError = (err: unknown): void => {
            cleanup();
            reject(err);
          };
          const onClose = (): void => {
            cleanup();
            if (finished) resolve();
            else reject(errored ?? abortError());
          };
          const cleanup = (): void => {
            w.off('finish', onFinish);
            w.off('error', onError);
            w.off('close', onClose);
          };
          w.on('finish', onFinish);
          w.on('error', onError);
          w.on('close', onClose);
          w.end();
        });
      },
      abort(reason): void {
        w.destroy(reason instanceof Error ? reason : new Error(String(reason)));
      },
    });
  }
}

export interface Writable extends WritableImplementation {}

export type WritableConstructor = CallableStreamConstructor<
  typeof WritableImplementation,
  Writable,
  WritableOptions
>;

export const Writable: WritableConstructor = makeCallableStreamConstructor(
  'Writable',
  WritableImplementation,
  (receiver, options) => {
    EventEmitter.call(receiver);
    initializeWritable(receiver, options);
  },
);

function abortError(): Error {
  const err = new Error('The operation was aborted') as Error & { code?: string };
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}
