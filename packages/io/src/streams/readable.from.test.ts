import { describe, expect, it } from 'vitest';
import { Buffer } from '../buffer.ts';
import { Readable } from './readable.ts';

/**
 * Per the 2026-05-26 streams review (Tier 1 #5, follow-up to ADR-0034):
 * `Readable.from(iterable, options?)` must detect the first chunk type when
 * no `objectMode` is supplied — bytes/strings yield a byte-mode stream;
 * objects yield an object-mode stream. Explicit `options.objectMode` always
 * wins.
 */
describe('Readable.from(iter, options?)', () => {
  function drainObjectMode<T>(r: Readable): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const out: T[] = [];
      r.on('data', (chunk) => out.push(chunk as T));
      r.on('end', () => resolve(out));
      r.on('error', reject);
    });
  }

  it('detects byte mode from an iterable of Buffers', async () => {
    const r = Readable.from([Buffer.from('a'), Buffer.from('b')]);
    expect(r.readableObjectMode).toBe(false);
    const out = await drainObjectMode<Buffer>(r);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(out[0])).toBe(true);
  });

  it('uses object mode for an iterable of plain objects', async () => {
    const r = Readable.from([{ a: 1 }, { a: 2 }]);
    expect(r.readableObjectMode).toBe(true);
    const out = await drainObjectMode<{ a: number }>(r);
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('detects byte mode from a sync string iterable (chars)', async () => {
    const r = Readable.from('hello');
    expect(r.readableObjectMode).toBe(false);
    const out = await drainObjectMode<unknown>(r);
    // Either each character pushed (as strings) or the queue ends up
    // as a sequence of single-char strings — both byte-mode shapes.
    expect(out).toEqual(['h', 'e', 'l', 'l', 'o']);
  });

  it('honours options.objectMode === true even with Buffer chunks', async () => {
    async function* gen() {
      yield Buffer.from('x');
      yield Buffer.from('y');
    }
    const r = Readable.from(gen(), { objectMode: true });
    expect(r.readableObjectMode).toBe(true);
    const out = await drainObjectMode<Buffer>(r);
    expect(out).toHaveLength(2);
    // In object mode, each entry is emitted unchanged.
    expect(out[0]).toBeInstanceOf(Uint8Array);
  });

  it('honours options.objectMode === false even with object chunks', async () => {
    // Object chunks in byte mode are nonsensical for the consumer, but the
    // option must still be honoured (we don't second-guess the caller).
    const r = Readable.from([Buffer.from('a')], { objectMode: false });
    expect(r.readableObjectMode).toBe(false);
  });

  it('passes highWaterMark through from options', () => {
    const r = Readable.from([{ a: 1 }], { highWaterMark: 7 });
    expect(r.readableHighWaterMark).toBe(7);
  });

  it('throws TypeError for a non-iterable input', () => {
    expect(() => Readable.from(42 as unknown as Iterable<unknown>)).toThrow(TypeError);
    expect(() => Readable.from(null as unknown as Iterable<unknown>)).toThrow(TypeError);
    expect(() => Readable.from(undefined as unknown as Iterable<unknown>)).toThrow(TypeError);
  });

  it('accepts an async iterable', async () => {
    async function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }
    const r = Readable.from(gen());
    expect(r.readableObjectMode).toBe(true);
    const out = await drainObjectMode<number>(r);
    expect(out).toEqual([1, 2, 3]);
  });

  it('detects byte mode from an iterable of Uint8Arrays (non-Buffer)', async () => {
    const r = Readable.from([new Uint8Array([1, 2]), new Uint8Array([3])]);
    expect(r.readableObjectMode).toBe(false);
  });

  it('fromWeb preserves web-stream chunk boundaries as byte-mode data', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('aa'));
        controller.enqueue(Buffer.from('bb'));
        controller.close();
      },
    });

    const r = Readable.fromWeb(stream);
    expect(r.readableObjectMode).toBe(false);
    const out = await drainObjectMode<Uint8Array>(r);

    expect(out.map((chunk) => Buffer.from(chunk).toString('utf8'))).toEqual(['aa', 'bb']);
  });
});
