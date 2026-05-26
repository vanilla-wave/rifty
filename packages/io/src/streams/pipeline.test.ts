import { describe, expect, it } from 'vitest';
import { finished, pipeline } from './pipeline.ts';
import { Readable } from './readable.ts';
import { Transform } from './transform.ts';
import { Writable } from './writable.ts';

describe('pipeline()', () => {
  it('chains Readable -> Transform -> Writable end-to-end', async () => {
    const src = Readable.from(['a', 'b', 'c']);
    const upper = new Transform({
      objectMode: true,
      transform(chunk, _enc, cb) {
        cb(null, String(chunk).toUpperCase());
      },
    });
    const seen: unknown[] = [];
    const sink = new Writable({
      objectMode: true,
      write(chunk, _enc, cb) {
        seen.push(chunk);
        cb();
      },
    });
    await pipeline(src, upper, sink);
    expect(seen).toEqual(['A', 'B', 'C']);
  });

  it('propagates errors from a source stream and rejects the promise', async () => {
    const src = new Readable({ objectMode: true });
    const passthrough = new Transform({
      objectMode: true,
      transform(chunk, _enc, cb) {
        cb(null, chunk);
      },
    });
    const sink = new Writable({
      objectMode: true,
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    // Swallow the `error` event so the EE throw-on-no-listener doesn't fire
    // before pipeline attaches; pipeline attaches synchronously, so this is
    // belt-and-braces.
    src.on('error', () => {});
    queueMicrotask(() => src.emit('error', new Error('boom')));
    await expect(pipeline(src, passthrough, sink)).rejects.toThrow(/boom/);
  });

  it('propagates errors from a Writable sink and rejects the promise', async () => {
    const src = Readable.from(['x']);
    const sink = new Writable({
      objectMode: true,
      write(_chunk, _enc, cb) {
        cb(new Error('sink-fail'));
      },
    });
    sink.on('error', () => {}); // belt-and-braces
    await expect(pipeline(src, sink)).rejects.toThrow(/sink-fail/);
  });

  it('throws TypeError synchronously when an argument is not a stream', () => {
    const src = Readable.from(['x']);
    const notAStream: unknown = {};
    // pipeline must reject the bad argument BEFORE any pipe wiring runs, so
    // callers don't get a cryptic `dest.write is not a function` later. The
    // error names the offending argument's position.
    expect(() => pipeline(src, notAStream)).toThrow(TypeError);
    expect(() => pipeline(src, notAStream)).toThrow(/stream/i);
    expect(() => pipeline(src, notAStream)).toThrow(/index 1/);
  });

  it('throws TypeError when the first argument is not a stream', () => {
    const sink = new Writable({
      objectMode: true,
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    expect(() => pipeline('not-a-stream' as unknown, sink)).toThrow(TypeError);
    expect(() => pipeline('not-a-stream' as unknown, sink)).toThrow(/index 0/);
  });

  it('accepts a trailing callback (does not treat it as a stream)', async () => {
    const src = Readable.from(['x']);
    const sink = new Writable({
      objectMode: true,
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    await new Promise<void>((resolve, reject) => {
      pipeline(src, sink, (err?: Error | null) => (err ? reject(err) : resolve()));
    });
  });
});

describe('finished()', () => {
  it('resolves when the stream emits `end`', async () => {
    const r = Readable.from([1, 2, 3]);
    const seen: unknown[] = [];
    r.on('data', (chunk) => seen.push(chunk));
    await finished(r);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('rejects when the stream emits `error`', async () => {
    const r = new Readable();
    r.on('error', () => {}); // suppress throw-on-no-listener
    const p = finished(r);
    queueMicrotask(() => r.emit('error', new Error('nope')));
    await expect(p).rejects.toThrow(/nope/);
  });
});
