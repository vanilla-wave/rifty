import { EventEmitter } from './events.ts';

interface ReadableOptions {
  highWaterMark?: number;
  encoding?: string;
  objectMode?: boolean;
  read?(this: Readable, size: number): void;
}

interface WritableOptions {
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

interface TransformOptions extends ReadableOptions, WritableOptions {
  transform?(
    this: Transform,
    chunk: unknown,
    encoding: string,
    cb: (err?: Error | null, value?: unknown) => void,
  ): void;
  flush?(this: Transform, cb: (err?: Error | null) => void): void;
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

  pipe<W extends Writable>(dest: W, opts: { end?: boolean } = {}): W {
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

function chunkSize(chunk: unknown): number {
  if (chunk == null) return 0;
  if (typeof chunk === 'string') return chunk.length;
  if (chunk instanceof Uint8Array) return chunk.length;
  return 1;
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

export class Duplex extends Readable {
  writableSide: Writable;
  constructor(opts: ReadableOptions & WritableOptions = {}) {
    super(opts);
    this.writableSide = new Writable(opts);
    // Re-expose Writable methods on this instance.
    this.write = (chunk, encoding, cb) => this.writableSide.write(chunk, encoding, cb);
    this.end = (...args: unknown[]) => {
      this.writableSide.end(args[0], args[1] as string, args[2] as () => void);
      return this;
    };
  }
  // Augmented at construction time:
  write!: (
    chunk: unknown,
    encoding?: string | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => boolean;
  end!: (...args: unknown[]) => this;
}

export class Transform extends Duplex {
  private transformImpl?: TransformOptions['transform'];
  private flushImpl?: TransformOptions['flush'];

  constructor(opts: TransformOptions = {}) {
    super(opts);
    this.transformImpl = opts.transform;
    this.flushImpl = opts.flush;
    // Wire writable side to call _transform.
    const origWrite = this.writableSide.write.bind(this.writableSide);
    this.write = (chunk, encoding, cb) => {
      const encStr = typeof encoding === 'string' ? encoding : 'utf8';
      const cbFinal = (typeof encoding === 'function' ? encoding : cb) ?? (() => {});
      if (this.transformImpl) {
        this.transformImpl.call(this, chunk, encStr, (err, value) => {
          if (err) {
            cbFinal(err);
            return;
          }
          if (value !== undefined && value !== null) this.push(value);
          cbFinal();
        });
        return origWrite(chunk, encStr, () => {});
      }
      // Default identity transform.
      this.push(chunk);
      cbFinal();
      return origWrite(chunk, encStr, () => {});
    };
    this.end = (...args: unknown[]) => {
      // Flush any pending data, then push null to end the readable side.
      const finalize = (): void => {
        this.push(null);
      };
      if (this.flushImpl)
        this.flushImpl.call(this, (err) => {
          if (err) this.emit('error', err);
          else finalize();
        });
      else finalize();
      this.writableSide.end(args[0], args[1] as string, args[2] as () => void);
      return this;
    };
  }
}

export class PassThrough extends Transform {
  constructor(opts: TransformOptions = {}) {
    super({
      ...opts,
      transform(chunk, _encoding, cb) {
        cb(null, chunk);
      },
    });
  }
}

export function pipeline(...streams: unknown[]): Promise<void> {
  const cb =
    typeof streams[streams.length - 1] === 'function'
      ? (streams.pop() as (err?: Error | null) => void)
      : undefined;
  const chain = streams as (Readable | Writable)[];
  return new Promise((resolve, reject) => {
    let errored = false;
    const onError = (err: unknown): void => {
      if (errored) return;
      errored = true;
      cb?.(err as Error);
      reject(err);
    };
    for (let i = 0; i < chain.length - 1; i++) {
      const src = chain[i];
      const dst = chain[i + 1] as Writable;
      if (src && 'pipe' in src && typeof (src as Readable).pipe === 'function') {
        (src as Readable).pipe(dst);
      }
      (src as EventEmitter | undefined)?.on?.('error', onError);
    }
    const last = chain[chain.length - 1] as EventEmitter | undefined;
    last?.on?.('error', onError);
    last?.on?.('finish', () => {
      if (!errored) {
        cb?.(null);
        resolve();
      }
    });
    last?.on?.('end', () => {
      if (!errored) {
        cb?.(null);
        resolve();
      }
    });
  });
}

export function finished(stream: EventEmitter, cb?: (err?: Error | null) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error | null): void => {
      if (done) return;
      done = true;
      if (err) {
        cb?.(err);
        reject(err);
      } else {
        cb?.(null);
        resolve();
      }
    };
    stream.on('end', () => finish());
    stream.on('finish', () => finish());
    stream.on('close', () => finish());
    stream.on('error', (e) => finish(e as Error));
  });
}

const stream = { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
export default stream;
