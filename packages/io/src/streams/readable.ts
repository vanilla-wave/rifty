/**
 * Node-compatible `node:stream.Readable` — owned by `@rifty/io` per ADR-0012.
 *
 * Behaviour we replicate (excerpt from Node docs):
 *   - flowing/paused modes; `data` listener starts flow on next tick.
 *   - `push(null)` ends the stream; `end` fires once buffer drains.
 *   - `pipe(dest)` returns dest; respects backpressure via `pause/resume`.
 *   - `Readable.from(iter)` creates an object-mode stream from any iterable.
 */

import { EventEmitter } from '../event-emitter.ts';

export interface ReadableOptions {
  highWaterMark?: number;
  encoding?: string;
  objectMode?: boolean;
  read?(this: Readable, size: number): void;
}

export function chunkSize(chunk: unknown): number {
  if (chunk == null) return 0;
  if (typeof chunk === 'string') return chunk.length;
  if (chunk instanceof Uint8Array) return chunk.length;
  return 1;
}

export class Readable extends EventEmitter implements AsyncIterable<unknown> {
  readableHighWaterMark: number;
  readableObjectMode: boolean;
  destroyed = false;
  private buffer: unknown[] = [];
  private bufferLength = 0;
  private flowing: boolean | null = null;
  private ended = false;
  private endedEmitted = false;
  private readImpl?: (this: Readable, size: number) => void;

  constructor(opts: ReadableOptions = {}) {
    super();
    this.readableHighWaterMark = opts.highWaterMark ?? 16 * 1024;
    this.readableObjectMode = opts.objectMode ?? false;
    this.readImpl = opts.read;
    this.on('newListener', (event) => {
      if (event === 'data' && this.flowing === null) {
        this.flowing = true;
        queueMicrotask(() => this.flow());
      }
    });
  }

  /** Force-start flow on next tick. Used by tests / Readable.from. */
  protected startFlowing(): void {
    if (this.flowing === null) this.flowing = true;
    queueMicrotask(() => this.flow());
  }

  push(chunk: unknown): boolean {
    if (chunk === null) {
      this.ended = true;
      if (this.flowing) queueMicrotask(() => this.flow());
      return false;
    }
    this.buffer.push(chunk);
    this.bufferLength += this.readableObjectMode ? 1 : chunkSize(chunk);
    if (this.flowing) queueMicrotask(() => this.flow());
    return this.bufferLength < this.readableHighWaterMark;
  }

  read(_n?: number): unknown {
    if (this.buffer.length === 0) {
      if (this.readImpl && !this.ended) this.readImpl.call(this, this.readableHighWaterMark);
      return null;
    }
    const chunk = this.buffer.shift();
    this.bufferLength -= this.readableObjectMode ? 1 : chunkSize(chunk);
    return chunk;
  }

  private flow(): void {
    while (this.flowing && this.buffer.length > 0) {
      const chunk = this.buffer.shift();
      this.bufferLength -= this.readableObjectMode ? 1 : chunkSize(chunk);
      this.emit('data', chunk);
    }
    if (this.ended && !this.endedEmitted && this.buffer.length === 0) {
      this.endedEmitted = true;
      this.emit('end');
    }
    if (this.readImpl && !this.ended && this.bufferLength < this.readableHighWaterMark) {
      this.readImpl.call(this, this.readableHighWaterMark - this.bufferLength);
    }
  }

  resume(): this {
    this.flowing = true;
    queueMicrotask(() => this.flow());
    return this;
  }

  pause(): this {
    this.flowing = false;
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
    this.destroyed = true;
    if (err) this.emit('error', err);
    this.emit('close');
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
