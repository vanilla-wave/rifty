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
