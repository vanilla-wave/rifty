import { describe, expect, it } from 'vitest';
import { Writable, type WriteChunk } from './writable.ts';

const settle = (ms = 5): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * cork/uncork deferred-drain + real `_writev` batching (Node v0.11). Each pins a
 * specific acceptance bullet: defer-while-corked, single `_writev` on uncork,
 * `{chunk, encoding}` shape, sequential `_write` fallback, nested cork counter,
 * a subclass `_writev` override, `writableCorked`, and backpressure/`'drain'`.
 */
describe('Writable cork/uncork + _writev', () => {
  it('cork() defers writes; uncork() flushes them in ONE _writev', async () => {
    const calls: WriteChunk[][] = [];
    const w = new Writable({
      objectMode: true,
      writev(chunks, cb) {
        calls.push(chunks);
        cb();
      },
    });
    w.cork();
    w.write('a', 'utf8');
    w.write('b', 'utf8');
    // Still corked → no flush, even after microtasks/timers settle (this await
    // is what makes the defer guard deterministic: a drain that wrongly fired
    // while corked would have run by now).
    await settle();
    expect(calls).toHaveLength(0);
    expect(w.writableLength).toBe(2);
    w.uncork();
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      { chunk: 'a', encoding: 'utf8' },
      { chunk: 'b', encoding: 'utf8' },
    ]);
  });

  it('falls back to sequential _write (order preserved) when no _writev', async () => {
    const writes: string[] = [];
    const w = new Writable({
      objectMode: true,
      write(chunk, _enc, cb) {
        writes.push(String(chunk));
        cb();
      },
    });
    w.cork();
    w.write('a', 'utf8');
    w.write('b', 'utf8');
    w.write('c', 'utf8');
    w.uncork();
    await settle();
    expect(writes).toEqual(['a', 'b', 'c']);
  });

  it('does not batch uncorked back-to-back writes through _writev when _write exists', async () => {
    const calls: string[] = [];
    const w = new Writable({
      objectMode: true,
      write(chunk, _enc, cb) {
        calls.push(`write:${chunk}`);
        cb();
      },
      writev(chunks, cb) {
        calls.push(`writev:${chunks.map((entry) => entry.chunk).join(',')}`);
        cb();
      },
    });

    w.write('a');
    w.write('b');
    await settle();

    expect(calls).toEqual(['write:a', 'write:b']);
  });

  it('nested cork: flush only after the cork counter returns to 0', async () => {
    const calls: WriteChunk[][] = [];
    const w = new Writable({
      objectMode: true,
      writev(chunks, cb) {
        calls.push(chunks);
        cb();
      },
    });
    w.cork();
    w.cork();
    expect(w.writableCorked).toBe(2);
    w.write('x', 'utf8');
    w.uncork();
    // Still corked (count 1) — no flush, even after a settle.
    expect(w.writableCorked).toBe(1);
    await settle();
    expect(calls).toHaveLength(0);
    w.uncork();
    await settle();
    expect(w.writableCorked).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((e) => e.chunk)).toEqual(['x']);
  });

  it('honors a subclass _writev override with the batched array', async () => {
    const calls: WriteChunk[][] = [];
    class BatchSink extends Writable {
      override _writev(chunks: WriteChunk[], cb: (err?: Error | null) => void): void {
        calls.push(chunks);
        cb();
      }
    }
    const w = new BatchSink({ objectMode: true });
    w.cork();
    w.write('p', 'utf8');
    w.write('q', 'utf8');
    w.uncork();
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((e) => e.chunk)).toEqual(['p', 'q']);
  });

  it('a corked stream still reports backpressure and drains after uncork', async () => {
    const drains: number[] = [];
    const w = new Writable({
      objectMode: true,
      highWaterMark: 2,
      writev(_chunks, cb) {
        setTimeout(cb, 1);
      },
    });
    w.on('drain', () => drains.push(1));
    w.cork();
    expect(w.write('a', 'utf8')).toBe(true);
    expect(w.write('b', 'utf8')).toBe(false); // hit HWM
    expect(w.write('c', 'utf8')).toBe(false); // past HWM
    w.uncork();
    await settle(15);
    expect(drains.length).toBeGreaterThanOrEqual(1);
  });

  it('a _writev error errors EVERY batched callback and destroys the stream', async () => {
    const fail = new Error('writev-fail');
    const cbErrs: Array<Error | null | undefined> = [];
    let emitted: unknown;
    const w = new Writable({
      objectMode: true,
      writev(_chunks, cb) {
        cb(fail);
      },
    });
    w.on('error', (e) => {
      emitted = e;
    });
    w.cork();
    w.write('a', 'utf8', (e) => cbErrs.push(e));
    w.write('b', 'utf8', (e) => cbErrs.push(e));
    w.uncork();
    await settle();
    expect(cbErrs).toEqual([fail, fail]);
    expect(emitted).toBe(fail);
    expect(w.destroyed).toBe(true);
  });

  it('end() flushes corked chunks (implicit uncork)', async () => {
    const calls: WriteChunk[][] = [];
    const w = new Writable({
      objectMode: true,
      writev(chunks, cb) {
        calls.push(chunks);
        cb();
      },
    });
    w.cork();
    w.write('a', 'utf8');
    w.write('b', 'utf8');
    await new Promise<void>((resolve) => w.end(() => resolve()));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((e) => e.chunk)).toEqual(['a', 'b']);
  });
});
