import { describe, expect, it } from 'vitest';
import { Readable } from './readable.ts';

/**
 * `Readable.toWeb(r)` (Node v17) returns a real WHATWG `ReadableStream` that is
 * pull-driven over `r`'s lifecycle:
 *   - reader yields `r`'s chunks in order, then `{done:true}` at end;
 *   - `r` erroring → reader rejects with the SAME error;
 *   - `reader.cancel()` → `r.destroy()` (no further data);
 *   - backpressure: a slow consumer holds the source bounded (no eager drain).
 */
describe('Readable.toWeb', () => {
  it('yields chunks in order then closes', async () => {
    const r = Readable.from(['a', 'b', 'c'], { objectMode: true });
    const reader = Readable.toWeb(r).getReader();
    const out: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('returns a real WHATWG ReadableStream', () => {
    const r = Readable.from(['x'], { objectMode: true });
    const web = Readable.toWeb(r);
    expect(web).toBeInstanceOf(ReadableStream);
    expect(typeof web.getReader).toBe('function');
  });

  it('rejects the web reader with the SAME error when the source errors', async () => {
    const r = new Readable({ objectMode: true, read() {} });
    const reader = Readable.toWeb(r).getReader();
    r.push('first');
    expect((await reader.read()).value).toBe('first');
    const boom = new Error('boom');
    r.destroy(boom);
    await expect(reader.read()).rejects.toBe(boom);
  });

  it('destroys the source when the web reader cancels', async () => {
    let dataAfterCancel = 0;
    const r = new Readable({ objectMode: true, read() {} });
    r.push('one');
    const reader = Readable.toWeb(r).getReader();
    expect((await reader.read()).value).toBe('one');
    r.on('data', () => {
      dataAfterCancel += 1;
    });
    await reader.cancel('done');
    await new Promise((res) => setTimeout(res, 10));
    expect(r.destroyed).toBe(true);
    expect(dataAfterCancel).toBe(0);
  });

  it('is pull-driven: a slow consumer does not eagerly drain the source', async () => {
    const r = Readable.from([1, 2, 3, 4, 5, 6], { objectMode: true, highWaterMark: 2 });
    const reader = Readable.toWeb(r).getReader();
    // Pull two chunks, then stop reading and let microtasks settle.
    expect((await reader.read()).value).toBe(1);
    expect((await reader.read()).value).toBe(2);
    await new Promise((res) => setTimeout(res, 20));
    // Source must NOT have run to completion just because we stopped reading.
    expect(r.readableEnded).toBe(false);
    // Resuming the pulls drains the rest, in order.
    const rest: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(value);
    }
    expect(rest).toEqual([3, 4, 5, 6]);
  });

  it('closes immediately for an already-ended empty source', async () => {
    const r = Readable.from([], { objectMode: true });
    // Let the source reach EOF before bridging.
    await new Promise((res) => setTimeout(res, 5));
    const reader = Readable.toWeb(r).getReader();
    const { done, value } = await reader.read();
    expect(done).toBe(true);
    expect(value).toBeUndefined();
  });
});
