import { describe, expect, it } from 'vitest';
import stream, {
  Duplex,
  PassThrough,
  Readable,
  Transform,
  Writable,
} from '../../../packages/runtime-js/src/builtins/stream.ts';
import util from '../../../packages/runtime-js/src/builtins/util.ts';

/**
 * Regression for the real-express run path: `send/index.js` does
 * `util.inherits(SendStream, require('stream'))` then `Stream.call(this)`.
 * Node's `require('stream')` is the legacy callable `Stream` base (a function
 * inheriting EventEmitter) with the modern classes attached. We collapse the
 * Readable→Stream→EventEmitter chain, but the stream module must still BE that
 * callable base or `util.inherits` throws "expects constructors".
 */
describe('node:stream — legacy callable Stream base', () => {
  it('default export is a callable function with the modern classes attached', () => {
    expect(typeof stream).toBe('function');
    const s = stream as unknown as Record<string, unknown>;
    expect(s.Readable).toBe(Readable);
    expect(s.Writable).toBe(Writable);
    expect(s.Stream).toBe(stream);
  });

  it('util.inherits(Child, require("stream")) + Stream.call(this) inits EventEmitter state', () => {
    const Stream = stream as unknown as (this: unknown) => void;
    function SendLike(this: unknown) {
      Stream.call(this);
    }
    expect(() => util.inherits(SendLike, Stream)).not.toThrow();
    expect((SendLike as unknown as { super_: unknown }).super_).toBe(stream);

    const inst = new (
      SendLike as unknown as new () => {
        on(e: string, l: (...a: unknown[]) => void): unknown;
        emit(e: string, ...a: unknown[]): boolean;
      }
    )();
    let got: unknown;
    inst.on('data', (v) => {
      got = v;
    });
    inst.emit('data', 42);
    expect(got).toBe(42);
  });

  it('serves bytes from an @jsonjoy-style Readable.call(this) subclass', async () => {
    const ReadableConstructor = Readable as unknown as {
      (this: unknown, opts?: { highWaterMark?: number }): void;
      prototype: object;
    };

    function FsReadStream(this: { sent?: boolean }) {
      this.sent = false;
      ReadableConstructor.call(this, { highWaterMark: 64 * 1024 });
    }
    util.inherits(FsReadStream, ReadableConstructor);
    (
      FsReadStream.prototype as {
        _read(size: number): void;
        push(chunk: unknown): boolean;
        sent?: boolean;
      }
    )._read = function _read(): void {
      if (this.sent) {
        this.push(null);
        return;
      }
      this.sent = true;
      this.push('webpack-asset');
    };

    const source = new (
      FsReadStream as unknown as new () => {
        on(event: string, listener: (...args: unknown[]) => void): unknown;
        resume(): unknown;
      }
    )();
    const body = await new Promise<string>((resolve, reject) => {
      let value = '';
      source.on('data', (chunk) => {
        value += String(chunk);
      });
      source.on('error', reject);
      source.on('end', () => resolve(value));
      source.resume();
    });

    expect(body).toBe('webpack-asset');
  });

  it('re-entry refreshes options without erasing installed stream hooks', () => {
    const readable = new Readable({
      read() {
        this.push('readable-value');
        this.push(null);
      },
    });
    const newListenerCount = readable.listenerCount('newListener');
    expect(Readable.call(readable, { objectMode: true, highWaterMark: 3 })).toBeUndefined();
    expect(readable.listenerCount('newListener')).toBe(newListenerCount);
    expect(readable.read()).toBe('readable-value');

    const writableCalls: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        writableCalls.push(`write:${String(chunk)}`);
        callback();
      },
      writev(chunks, callback) {
        writableCalls.push(`writev:${chunks.map(({ chunk }) => String(chunk)).join(',')}`);
        callback();
      },
      final(callback) {
        writableCalls.push('final');
        callback();
      },
    });
    expect(Writable.call(writable, { objectMode: true, highWaterMark: 4 })).toBeUndefined();
    writable.cork();
    writable.write('a');
    writable.write('b');
    writable.uncork();
    writable.write('c');
    writable.end();
    expect(writableCalls).toEqual(['writev:a,b', 'write:c', 'final']);

    const duplexCalls: string[] = [];
    const duplex = new Duplex({
      read() {
        this.push('duplex-read');
        this.push(null);
      },
      write(chunk, _encoding, callback) {
        duplexCalls.push(`write:${String(chunk)}`);
        callback();
      },
      final(callback) {
        duplexCalls.push('final');
        callback();
      },
    });
    expect(Duplex.call(duplex, { objectMode: true, highWaterMark: 5 })).toBeUndefined();
    expect(duplex.read()).toBe('duplex-read');
    duplex.write('duplex-value');
    duplex.end();
    expect(duplexCalls).toEqual(['write:duplex-value', 'final']);

    const transformCalls: string[] = [];
    const transform = new Transform({
      transform(chunk, _encoding, callback) {
        transformCalls.push(`transform:${String(chunk)}`);
        callback(null, `transformed:${String(chunk)}`);
      },
      flush(callback) {
        transformCalls.push('flush');
        callback();
      },
    });
    expect(Transform.call(transform, { objectMode: true, highWaterMark: 6 })).toBeUndefined();
    transform.write('transform-value');
    transform.end();
    expect(transform.read()).toBe('transformed:transform-value');
    expect(transformCalls).toEqual(['transform:transform-value', 'flush']);

    const passThrough = new PassThrough();
    expect(PassThrough.call(passThrough, { objectMode: true, highWaterMark: 7 })).toBeUndefined();
    passThrough.write('passthrough-value');
    expect(passThrough.read()).toBe('passthrough-value');
  });
});
