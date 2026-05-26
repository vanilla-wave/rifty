import { describe, expect, it } from 'vitest';
import { Readable } from './readable.ts';

/**
 * Per Node's documented contract:
 *   - `for await (const chunk of readable)` must not leak the listeners it
 *     attaches; early-break must detach them, and (per `stream.Readable`
 *     async-iterator spec) must signal the stream that the consumer is done,
 *     which destroys the stream.
 *   - Repeated iteration on the same Readable must not accumulate listeners.
 */
describe('Readable[Symbol.asyncIterator] listener hygiene', () => {
  it('removes data/end/error listeners after full iteration', async () => {
    const r = Readable.from([1, 2, 3]);
    const seen: unknown[] = [];
    for await (const v of r) {
      seen.push(v);
    }
    // The for-await body completed naturally; cleanup must have run.
    expect(seen).toEqual([1, 2, 3]);
    // Allow microtask flush for any deferred cleanup.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(r.listenerCount('data')).toBe(0);
    expect(r.listenerCount('end')).toBe(0);
    expect(r.listenerCount('error')).toBe(0);
  });

  it('removes data/end/error listeners on early break and destroys the stream', async () => {
    const r = Readable.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const seen: unknown[] = [];
    for await (const v of r) {
      seen.push(v);
      if (seen.length >= 3) break;
    }
    expect(seen).toEqual([1, 2, 3]);
    // Wait one microtask cycle for the iterator's return() cleanup.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(r.listenerCount('data')).toBe(0);
    expect(r.listenerCount('end')).toBe(0);
    expect(r.listenerCount('error')).toBe(0);
    // Node destroys the source when the async iterator's return() runs.
    expect(r.destroyed).toBe(true);
  });

  it('does not accumulate listeners across two sequential iterators on different Readables', async () => {
    // Two separate Readables iterated in sequence — each must clean up after itself.
    const r1 = Readable.from([1, 2]);
    for await (const _ of r1) {
      // consume
    }
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(r1.listenerCount('data')).toBe(0);
    expect(r1.listenerCount('end')).toBe(0);
    expect(r1.listenerCount('error')).toBe(0);

    const r2 = Readable.from([3, 4]);
    for await (const _ of r2) {
      // consume
    }
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(r2.listenerCount('data')).toBe(0);
    expect(r2.listenerCount('end')).toBe(0);
    expect(r2.listenerCount('error')).toBe(0);
  });

  it('detaches listeners and propagates a thrown error from the iterator body', async () => {
    const r = Readable.from([1, 2, 3, 4, 5]);
    const thrown = new Error('consumer-failed');
    let caught: unknown = null;
    try {
      for await (const v of r) {
        if (v === 2) throw thrown;
        void v;
      }
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(thrown);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(r.listenerCount('data')).toBe(0);
    expect(r.listenerCount('end')).toBe(0);
    expect(r.listenerCount('error')).toBe(0);
    // Per Node, an async-iterator throw also destroys the source.
    expect(r.destroyed).toBe(true);
  });
});
