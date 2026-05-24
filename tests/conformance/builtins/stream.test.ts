import { describe, expect, it } from 'vitest';
import {
  PassThrough,
  Readable,
  Transform,
  Writable,
  finished,
  pipeline,
} from '../../../packages/runtime-js/src/builtins/stream.ts';

function collect(r: Readable): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const out: unknown[] = [];
    r.on('data', (c) => out.push(c));
    r.on('end', () => resolve(out));
    r.on('error', reject);
  });
}

describe('stream.Readable', () => {
  it('emits data and end', async () => {
    const r = new Readable({ objectMode: true });
    r.push('a');
    r.push('b');
    r.push(null);
    await expect(collect(r)).resolves.toEqual(['a', 'b']);
  });

  it('async iteration yields chunks', async () => {
    const r = new Readable({ objectMode: true });
    r.push(1);
    r.push(2);
    r.push(null);
    const out: unknown[] = [];
    for await (const v of r) out.push(v);
    expect(out).toEqual([1, 2]);
  });

  it('Readable.from(iterable)', async () => {
    const r = Readable.from([10, 20, 30]);
    const out: unknown[] = [];
    for await (const v of r) out.push(v);
    expect(out).toEqual([10, 20, 30]);
  });
});

describe('stream.Writable', () => {
  it('collects chunks and emits finish', async () => {
    const sink: unknown[] = [];
    const w = new Writable({
      objectMode: true,
      write(chunk, _enc, cb) {
        sink.push(chunk);
        cb();
      },
    });
    w.write(1);
    w.write(2);
    w.end();
    await new Promise((r) => w.on('finish', r));
    expect(sink).toEqual([1, 2]);
  });

  it('backpressure: write returns false past highWaterMark', () => {
    const w = new Writable({
      highWaterMark: 4,
      write(_c, _e, cb) {
        // never call cb so buffer accumulates
        setTimeout(cb, 50);
      },
    });
    expect(w.write('aaaa')).toBe(false);
  });
});

describe('stream.Transform / PassThrough', () => {
  it('Transform processes chunks via _transform', async () => {
    const t = new Transform({
      objectMode: true,
      transform(chunk, _enc, cb) {
        cb(null, (chunk as number) * 2);
      },
    });
    t.write(1);
    t.write(2);
    t.end();
    const out: unknown[] = [];
    t.on('data', (c) => out.push(c));
    await new Promise((r) => t.on('end', r));
    expect(out).toEqual([2, 4]);
  });

  it('PassThrough forwards chunks unchanged', async () => {
    const pt = new PassThrough({ objectMode: true });
    pt.write('x');
    pt.write('y');
    pt.end();
    const out: unknown[] = [];
    pt.on('data', (c) => out.push(c));
    await new Promise((r) => pt.on('end', r));
    expect(out).toEqual(['x', 'y']);
  });
});

describe('stream.pipeline / finished', () => {
  it('pipeline chains readable → transform → writable', async () => {
    const src = Readable.from([1, 2, 3]);
    const doubled = new Transform({
      objectMode: true,
      transform(chunk, _e, cb) {
        cb(null, (chunk as number) * 2);
      },
    });
    const out: unknown[] = [];
    const sink = new Writable({
      objectMode: true,
      write(chunk, _e, cb) {
        out.push(chunk);
        cb();
      },
    });
    await pipeline(src, doubled, sink);
    expect(out).toEqual([2, 4, 6]);
  });

  it('finished resolves when readable ends', async () => {
    const r = Readable.from([1, 2]);
    r.on('data', () => {});
    await finished(r);
  });
});
