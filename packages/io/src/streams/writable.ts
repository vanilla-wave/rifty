/**
 * Node-compatible `node:stream.Writable` — owned by `@rifty/io` per ADR-0012.
 *
 * Implements the buffered write / `_write` / `_final` lifecycle plus the
 * `drain` event when the buffer falls below the high-water mark.
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

export class Writable extends EventEmitter {
  writableHighWaterMark: number;
  writableObjectMode: boolean;
  private writeImpl?: (
    this: Writable,
    chunk: unknown,
    encoding: string,
    cb: (err?: Error | null) => void,
  ) => void;
  private finalImpl?: (this: Writable, cb: (err?: Error | null) => void) => void;
  private buffered: { chunk: unknown; encoding: string; cb: (err?: Error | null) => void }[] = [];
  private bufferLength = 0;
  private writing = false;
  private ending = false;
  private finished = false;

  constructor(opts: WritableOptions = {}) {
    super();
    this.writableHighWaterMark = opts.highWaterMark ?? 16 * 1024;
    this.writableObjectMode = opts.objectMode ?? false;
    this.writeImpl = opts.write;
    this.finalImpl = opts.final;
  }

  write(
    chunk: unknown,
    encodingOrCb?: string | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean {
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8';
    const cbFinal = (typeof encodingOrCb === 'function' ? encodingOrCb : cb) ?? (() => {});
    this.buffered.push({ chunk, encoding, cb: cbFinal });
    this.bufferLength += this.writableObjectMode ? 1 : chunkSize(chunk);
    queueMicrotask(() => this.drainBuffer());
    return this.bufferLength < this.writableHighWaterMark;
  }

  private drainBuffer(): void {
    if (this.writing) return;
    const next = this.buffered.shift();
    if (!next) {
      if (this.ending && !this.finished) this.doFinal();
      return;
    }
    this.writing = true;
    this.bufferLength -= this.writableObjectMode ? 1 : chunkSize(next.chunk);
    const done = (err?: Error | null): void => {
      this.writing = false;
      if (err) {
        next.cb(err);
        this.emit('error', err);
        return;
      }
      next.cb();
      if (this.bufferLength < this.writableHighWaterMark) this.emit('drain');
      queueMicrotask(() => this.drainBuffer());
    };
    if (this.writeImpl) this.writeImpl.call(this, next.chunk, next.encoding, done);
    else done();
  }

  end(chunkOrCb?: unknown, encodingOrCb?: string | (() => void), cb?: () => void): this {
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
    this.ending = true;
    queueMicrotask(() => this.drainBuffer());
    return this;
  }

  private doFinal(): void {
    if (this.finished) return;
    this.finished = true;
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
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  }
}
