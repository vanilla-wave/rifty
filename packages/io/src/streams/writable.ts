/**
 * Node-compatible `node:stream.Writable` — owned by `@rifty/io` per ADR-0012.
 *
 * Implements the buffered write / `_write` / `_final` lifecycle plus the
 * `drain` event when the buffer falls below the high-water mark.
 *
 * Per ADR-0034, all state lives in `_writableState` (Node convention; the
 * single field-bag is what downstream callers and the wider Node ecosystem
 * inspect via `w._writableState.{destroyed,ended,finished,length}`). Fields
 * we use exactly mirror Node's `internal/streams/state.js`.
 */

import { EventEmitter } from '../event-emitter.ts';
import { chunkSize } from './readable.ts';

export interface WritableOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  decodeStrings?: boolean;
  write?(this: Writable, chunk: unknown, encoding: string, cb: (err?: Error | null) => void): void;
  writev?(
    this: Writable,
    chunks: { chunk: unknown; encoding: string }[],
    cb: (err?: Error | null) => void,
  ): void;
  final?(this: Writable, cb: (err?: Error | null) => void): void;
}

interface BufferedWrite {
  chunk: unknown;
  encoding: string;
  cb: (err?: Error | null) => void;
}

/**
 * Single state container shared across all `Writable` instances per Node's
 * `_writableState` convention. Field names mirror Node's
 * `internal/streams/state.js`; we surface only the fields rifty's tests,
 * downstream callers, or the wider Node ecosystem read or write.
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
   * Node's `'drain'` event fires only after a prior `write()` returned `false`
   * (buffer reached HWM). Plain consumption below HWM after a write that
   * already returned `true` must NOT emit `'drain'`. This flag tracks whether
   * we owe the consumer a `'drain'`.
   */
  needDrain: boolean;
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
    };
    this.writeImpl = opts.write;
    this.finalImpl = opts.final;
  }

  // ---- Public accessors that mirror Node's getters on `Writable`. ----

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

  write(
    chunk: unknown,
    encodingOrCb?: string | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean {
    const state = this._writableState;
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8';
    const cbFinal = (typeof encodingOrCb === 'function' ? encodingOrCb : cb) ?? (() => {});
    // After destroy / end / finished, the write contract is:
    //   - synchronously return false,
    //   - invoke the callback with an error on the next tick.
    if (state.destroyed) {
      const err = state.errored ?? new Error('Cannot call write after a stream was destroyed');
      queueMicrotask(() => cbFinal(err));
      return false;
    }
    if (state.ending || state.finished) {
      const err = new Error('write after end');
      queueMicrotask(() => {
        cbFinal(err);
        // Match Node: emit error so unattended writes-after-end surface.
        if (this.listenerCount('error') > 0) this.emit('error', err);
      });
      return false;
    }
    state.buffered.push({ chunk, encoding, cb: cbFinal });
    state.length += state.objectMode ? 1 : chunkSize(chunk);
    queueMicrotask(() => this.drainBuffer());
    const okToContinue = state.length < state.highWaterMark;
    // If we hit the HWM, set the needDrain flag so the next time the buffer
    // falls below HWM we emit `'drain'`. Don't clear the flag if it's already
    // set — `'drain'` is owed until it fires.
    if (!okToContinue) state.needDrain = true;
    return okToContinue;
  }

  private drainBuffer(): void {
    const state = this._writableState;
    if (state.writing) return;
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
    const done = (err?: Error | null): void => {
      state.writing = false;
      // The stream may have been destroyed during the synchronous `_write`
      // call. Drop the success path and let the destroy-drainage path own
      // callback delivery.
      if (state.destroyed) {
        // Fire this entry's callback with the destroy error if any; the rest
        // of the queue is drained below via the destroyed-branch above on the
        // next drainBuffer() pass.
        const destErr = state.errored ?? err ?? new Error('Premature close');
        next.cb(destErr);
        // Drain remaining queued writes with the same error.
        queueMicrotask(() => this.drainBuffer());
        return;
      }
      if (err) {
        next.cb(err);
        this.emit('error', err);
        return;
      }
      next.cb();
      // Only emit 'drain' if we previously told the consumer write() returned
      // false (HWM tripped). Match Node's protocol: don't fire on every dip
      // below HWM.
      if (state.needDrain && state.length < state.highWaterMark) {
        state.needDrain = false;
        this.emit('drain');
      }
      queueMicrotask(() => this.drainBuffer());
    };
    if (this.writeImpl) this.writeImpl.call(this, next.chunk, next.encoding, done);
    else done();
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
    queueMicrotask(() => this.drainBuffer());
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
    if (this.finalImpl) this.finalImpl.call(this, finalize);
    else finalize();
  }

  destroy(err?: Error): this {
    const state = this._writableState;
    if (state.destroyed) return this;
    state.destroyed = true;
    if (err) state.errored = err;
    // Cancel any in-flight queued writes by erroring their callbacks. We can't
    // cancel the *currently* writing chunk's `_write` (it's already running on
    // the user's call stack), but we can prevent its `done` from succeeding —
    // the `done` closure checks `state.destroyed` before emitting drain/finish.
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
