import { describe, expect, it } from 'vitest';
import { Readable } from './readable.ts';
import { Writable } from './writable.ts';

/**
 * Contract under test (per ADR-0034 + 2026-05-26 streams review): `pipe(dest)`
 * must install symmetric error wiring (source-error tears down the dest hooks,
 * dest-error tears down the source hooks) and a matching `unpipe(dest?)` must
 * detach everything it attached. Tests below pin the listener-count contract
 * directly so future drift is caught the moment it happens.
 */
describe('Readable.pipe / Readable.unpipe', () => {
  function makeSilentWritable(opts?: { hwm?: number }): Writable {
    const w = new Writable({
      highWaterMark: opts?.hwm ?? 16 * 1024,
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    return w;
  }

  it('pipe(dest) attaches listeners; unpipe(dest) detaches them on both ends', () => {
    const r = new Readable({ read() {} });
    const w = makeSilentWritable();

    const srcBefore = {
      data: r.listenerCount('data'),
      end: r.listenerCount('end'),
      error: r.listenerCount('error'),
    };
    const destBefore = {
      drain: w.listenerCount('drain'),
      error: w.listenerCount('error'),
      close: w.listenerCount('close'),
    };

    r.pipe(w);
    expect(r.listenerCount('data')).toBeGreaterThan(srcBefore.data);
    expect(r.listenerCount('end')).toBeGreaterThan(srcBefore.end);
    expect(r.listenerCount('error')).toBeGreaterThan(srcBefore.error);
    expect(w.listenerCount('drain')).toBeGreaterThan(destBefore.drain);
    expect(w.listenerCount('error')).toBeGreaterThan(destBefore.error);

    r.unpipe(w);
    expect(r.listenerCount('data')).toBe(srcBefore.data);
    expect(r.listenerCount('end')).toBe(srcBefore.end);
    expect(r.listenerCount('error')).toBe(srcBefore.error);
    expect(w.listenerCount('drain')).toBe(destBefore.drain);
    expect(w.listenerCount('error')).toBe(destBefore.error);
    expect(w.listenerCount('close')).toBe(destBefore.close);
  });

  it('piping twice to the same dest, then unpipe(dest) once, removes both wirings', () => {
    const r = new Readable({ read() {} });
    const w = makeSilentWritable();

    r.pipe(w);
    r.pipe(w);
    r.unpipe(w);
    expect(r.listenerCount('data')).toBe(0);
    expect(r.listenerCount('end')).toBe(0);
    expect(r.listenerCount('error')).toBe(0);
    expect(w.listenerCount('drain')).toBe(0);
    expect(w.listenerCount('error')).toBe(0);
  });

  it('unpipe() with no arg unpipes all dests', () => {
    const r = new Readable({ read() {} });
    const w1 = makeSilentWritable();
    const w2 = makeSilentWritable();
    r.pipe(w1);
    r.pipe(w2);
    expect(r.listenerCount('data')).toBeGreaterThan(0);
    r.unpipe();
    expect(r.listenerCount('data')).toBe(0);
    expect(r.listenerCount('end')).toBe(0);
    expect(r.listenerCount('error')).toBe(0);
    expect(w1.listenerCount('drain')).toBe(0);
    expect(w1.listenerCount('error')).toBe(0);
    expect(w2.listenerCount('drain')).toBe(0);
    expect(w2.listenerCount('error')).toBe(0);
  });

  it('source error detaches dest drain listener', async () => {
    const r = new Readable({ read() {} });
    const w = makeSilentWritable();
    // belt-and-braces — pipe attaches its own error listener; this absorbs
    // the re-emit on dest.
    w.on('error', () => {});
    r.on('error', () => {});
    r.pipe(w);
    expect(w.listenerCount('drain')).toBeGreaterThan(0);
    queueMicrotask(() => r.emit('error', new Error('src-boom')));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(w.listenerCount('drain')).toBe(0);
    // The pipe's own error listener on dest is gone after cleanup; ours stays.
    expect(w.listenerCount('error')).toBe(1);
  });

  it('dest error detaches source data/end listeners', async () => {
    const r = new Readable({ read() {} });
    const w = makeSilentWritable();
    w.on('error', () => {});
    r.on('error', () => {});
    r.pipe(w);
    expect(r.listenerCount('data')).toBeGreaterThan(0);
    queueMicrotask(() => w.emit('error', new Error('dest-boom')));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(r.listenerCount('data')).toBe(0);
    expect(r.listenerCount('end')).toBe(0);
  });

  it('pipe(dest, {end:false}) does not call dest.end() when source ends', async () => {
    const r = new Readable({ read() {} });
    const w = makeSilentWritable();
    let ended = false;
    const origEnd = w.end.bind(w);
    w.end = ((...args: unknown[]) => {
      ended = true;
      // biome-ignore lint/suspicious/noExplicitAny: spy passthrough
      return (origEnd as any)(...args);
    }) as typeof w.end;

    r.pipe(w, { end: false });
    r.push('chunk');
    r.push(null);
    await new Promise<void>((resolve) => r.once('end', () => resolve()));
    // Yield once more so any pending end() would have run.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(ended).toBe(false);
  });

  it('default pipe(dest) DOES call dest.end() when source ends', async () => {
    const r = new Readable({ read() {} });
    const w = makeSilentWritable();
    let ended = false;
    w.on('finish', () => {
      ended = true;
    });
    r.pipe(w);
    r.push('chunk');
    r.push(null);
    await new Promise<void>((resolve) => w.once('finish', () => resolve()));
    expect(ended).toBe(true);
  });

  it('still propagates data end-to-end after the new wiring', async () => {
    const r = Readable.from(['a', 'b', 'c']);
    const seen: unknown[] = [];
    const w = new Writable({
      objectMode: true,
      write(chunk, _enc, cb) {
        seen.push(chunk);
        cb();
      },
    });
    r.pipe(w);
    await new Promise<void>((resolve) => w.once('finish', () => resolve()));
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});
