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

import { EventEmitter } from '../event-emitter.ts';
import { chunkSize } from './readable.ts';

export interface WritableOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  decodeStrings?: boolean;
  write?(this: Writable, chunk: unknown, encoding: string, cb: (err?: Error | null) => void): void;
  // No `writev?` here: it was a type-only placeholder used NOWHERE (drainBuffer
  // always calls `_write` per chunk), i.e. a silent lie that the option did
  // something (no-silent-stub rule). Real cork/uncork/`_writev` batching is owned
  // by whatwg-stream-bridge-and-statics; it re-adds the option when it lands.
  final?(this: Writable, cb: (err?: Error | null) => void): void;
}

interface BufferedWrite {
  chunk: unknown;
  encoding: string;
  cb: (err?: Error | null) => void;
}

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
  /** Re-entrancy guard while a chunk is being flushed via `_write`. */
  writing: boolean;
  /** `true` once `.end()` has been called. */
  ending: boolean;
  /** `true` after `_final` has resolved (or no `_final` and the queue drained). */
  finished: boolean;
  /** `true` after `destroy()`. */
  destroyed: boolean;
  /** Error from `destroy(err)` if any. */
  errored: Error | null;
  /**
   * Whether a `'drain'` is owed. Node fires `'drain'` only after a prior
   * `write()` returned `false` (buffer hit HWM); a dip below HWM after a write
   * that returned `true` must NOT emit it.
   */
  needDrain: boolean;
  /**
   * Coalescing flag: at most one `drainBuffer()` microtask is pending at a
   * time. N writes in one tick schedule one turn, not N (the drain loop then
   * processes synchronously-completing chunks in the same tick).
   */
  drainScheduled: boolean;
}

export class Writable extends EventEmitter {
  readonly _writableState: WritableState;
  private writeImpl?: (
    this: Writable,
    chunk: unknown,
    encoding: string,
    cb: (err?: Error | null) => void,
  ) => void;
  private finalImpl?: (this: Writable, cb: (err?: Error | null) => void) => void;

  constructor(opts: WritableOptions = {}) {
    super();
    this._writableState = {
      buffered: [],
      length: 0,
      highWaterMark: opts.highWaterMark ?? 16 * 1024,
      objectMode: opts.objectMode ?? false,
      writing: false,
      ending: false,
      finished: false,
      destroyed: false,
      errored: null,
      needDrain: false,
      drainScheduled: false,
    };
    this.writeImpl = opts.write;
    this.finalImpl = opts.final;
  }

  _write(_chunk: unknown, _encoding: string, cb: (err?: Error | null) => void): void {
    cb();
  }

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
    if (state.destroyed) {
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
    state.buffered.push({ chunk, encoding, cb: cbFinal });
    state.length += state.objectMode ? 1 : chunkSize(chunk);
    this.scheduleDrain();
    const okToContinue = state.length < state.highWaterMark;
    // Hit HWM: owe a 'drain' for the next dip below it. Don't clear once set.
    if (!okToContinue) state.needDrain = true;
    return okToContinue;
  }

  private drainBuffer(): void {
    const state = this._writableState;
    if (state.writing) return;
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
      const next = state.buffered.shift();
      if (!next) {
        if (state.ending && !state.finished) this.doFinal();
        return;
      }
      state.writing = true;
      state.length -= state.objectMode ? 1 : chunkSize(next.chunk);
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
          const destErr = state.errored ?? err ?? new Error('Premature close');
          next.cb(destErr);
          if (!inSyncWrite) this.scheduleDrain();
          return;
        }
        if (err) {
          // Node destroys the stream on a `_write` error: the failing chunk's
          // callback gets the error, then destroy() errors every still-buffered
          // callback and emits 'error'+'close'. Previously the queued chunks'
          // callbacks were left uncalled and `destroyed` stayed false.
          next.cb(err);
          this.destroy(err);
          return;
        }
        next.cb();
        // Emit 'drain' only if a prior write() returned false; not on every dip below HWM.
        if (state.needDrain && state.length < state.highWaterMark) {
          state.needDrain = false;
          this.emit('drain');
        }
        // Async completion re-arms the loop; sync completion lets the loop
        // advance to the next chunk in this tick (no extra microtask).
        if (inSyncWrite) mayContinueSync = true;
        else this.scheduleDrain();
      };
      const writeImpl = this.writeImpl ?? this._write;
      writeImpl.call(this, next.chunk, next.encoding, done);
      inSyncWrite = false;
      // Continue only on a clean synchronous completion; stop on async-pending
      // (`done` deferred → re-arms via scheduleDrain), error, or destroy.
      if (!mayContinueSync) return;
    }
  }

  end(chunkOrCb?: unknown, encodingOrCb?: string | (() => void), cb?: () => void): this {
    const state = this._writableState;
    let cbFinal: (() => void) | undefined;
    if (typeof chunkOrCb === 'function') {
      cbFinal = chunkOrCb as () => void;
    } else if (chunkOrCb !== undefined) {
      this.write(chunkOrCb, typeof encodingOrCb === 'string' ? encodingOrCb : undefined);
      cbFinal = (typeof encodingOrCb === 'function' ? encodingOrCb : cb) as
        | (() => void)
        | undefined;
    } else {
      cbFinal = typeof encodingOrCb === 'function' ? (encodingOrCb as () => void) : cb;
    }
    if (cbFinal) this.once('finish', cbFinal);
    state.ending = true;
    this.scheduleDrain();
    return this;
  }

  private doFinal(): void {
    const state = this._writableState;
    if (state.finished) return;
    state.finished = true;
    const finalize = (err?: Error | null): void => {
      if (err) this.emit('error', err);
      else {
        this.emit('finish');
        this.emit('close');
      }
    };
    const finalImpl = this.finalImpl ?? this._final;
    finalImpl.call(this, finalize);
  }

  destroy(err?: Error): this {
    const state = this._writableState;
    if (state.destroyed) return this;
    state.destroyed = true;
    if (err) state.errored = err;
    // Error queued writes' callbacks. Can't cancel the chunk currently in
    // `_write` (already running on the user's stack), but its `done` closure
    // checks `state.destroyed` before emitting drain/finish.
    const queue = state.buffered.slice();
    state.buffered.length = 0;
    state.length = 0;
    const destroyErr = err ?? new Error('Premature close');
    queueMicrotask(() => {
      for (const entry of queue) entry.cb(destroyErr);
      // Match Node: emit error (if any) then close on the next tick.
      if (err) this.emit('error', err);
      this.emit('close');
    });
    return this;
  }
}
