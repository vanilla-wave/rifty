import { describe, expect, it, vi } from 'vitest';
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

  it('toWeb preserves object-mode chunks instead of stringifying them', async () => {
    const first = { a: 1 };
    const stream = Readable.toWeb(Readable.from([first, { a: 2 }]));
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toEqual({ done: false, value: first });
    await expect(reader.read()).resolves.toEqual({ done: false, value: { a: 2 } });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('toWeb preserves string chunks as strings', async () => {
    const stream = Readable.toWeb(Readable.from(['x']));
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toEqual({ done: false, value: 'x' });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('toWeb preserves object-mode typed chunks by identity', async () => {
    const typed = new Uint16Array([258, 772]);
    const view = new DataView(new ArrayBuffer(4));
    const stream = Readable.toWeb(Readable.from([typed, view], { objectMode: true }));
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toEqual({ done: false, value: typed });
    await expect(reader.read()).resolves.toEqual({ done: false, value: view });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it('toWeb rejects arbitrary async iterables instead of widening the Node surface', () => {
    const iterable = {
      async *[Symbol.asyncIterator]() {
        yield 'x';
      },
    };

    expect(() => Readable.toWeb(iterable as unknown as Readable)).toThrow(TypeError);
  });

  it('toWeb passes a supplied strategy through to the Web ReadableStream', async () => {
    const size = vi.fn(() => 1);
    const stream = Readable.toWeb(Readable.from(['x']), { strategy: { size } });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const reader = stream.getReader();

    await expect(reader.read()).resolves.toEqual({ done: false, value: 'x' });
    expect(size).toHaveBeenCalledWith('x');
  });

  it('toWeb destroys the source when the web reader cancels', async () => {
    const source = new Readable({
      read() {
        this.push('x');
      },
    });
    const closed = new Promise<void>((resolve) => {
      source.on('close', () => resolve());
    });
    const stream = Readable.toWeb(source);
    const reader = stream.getReader();

    await reader.cancel('stop');

    await closed;
    expect(source.destroyed).toBe(true);
  });

  // A read that never settles is the bug being guarded — race a timeout so the
  // assertion fails fast (and visibly) instead of hanging the suite.
  const settle = <T>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`toWeb never settled: ${label}`)), 1_000),
      ),
    ]);

  it('toWeb of an already-ended source closes the web stream (does not hang)', async () => {
    const source = Readable.from(['a', 'b']);
    await new Promise<void>((resolve) => {
      source.on('data', () => {});
      source.on('end', () => resolve());
    });
    expect(source.readableEnded).toBe(true);

    const reader = Readable.toWeb(source).getReader();
    await expect(settle(reader.read(), 'already-ended')).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('toWeb of an already-destroyed (no error) source aborts the web stream (does not hang)', async () => {
    const source = new Readable({ read() {} });
    source.on('error', () => {}); // absorb the destroy 'error' on the source
    source.destroy();
    expect(source.destroyed).toBe(true);

    const reader = Readable.toWeb(source).getReader();
    await expect(settle(reader.read(), 'already-destroyed')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('toWeb aborts the web stream when the source is destroyed without an error mid-stream (no clean-EOF lie)', async () => {
    const source = new Readable({ read() {} });
    source.on('error', () => {});
    const reader = Readable.toWeb(source).getReader();
    source.push('partial');
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: expect.anything(),
    });

    source.destroy(); // premature close — NOT a clean end
    await expect(settle(reader.read(), 'destroy-mid-stream')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('toWeb surfaces a source error on the web stream', async () => {
    const source = new Readable({ read() {} });
    const boom = new Error('boom');
    const reader = Readable.toWeb(source).getReader();
    source.destroy(boom);
    await expect(settle(reader.read(), 'source-error')).rejects.toBe(boom);
  });

  it('web cancel with no reason destroys the source with an AbortError (Node parity)', async () => {
    const source = new Readable({ read() {} });
    const errored = new Promise<unknown>((resolve) => source.on('error', resolve));
    const reader = Readable.toWeb(source).getReader();

    await reader.cancel(); // no reason

    await expect(errored).resolves.toMatchObject({ name: 'AbortError' });
    expect(source.destroyed).toBe(true);
  });

  it('web cancel forwards a string reason to the source error (reason is not dropped)', async () => {
    const source = new Readable({ read() {} });
    const errored = new Promise<unknown>((resolve) => source.on('error', resolve));
    const reader = Readable.toWeb(source).getReader();

    await reader.cancel('stop-reason');

    await expect(errored).resolves.toBe('stop-reason');
  });
});
