import { describe, expect, it, vi } from 'vitest';
import { Buffer } from '../buffer.ts';
import { Readable, type ReadableOptions } from './readable.ts';

/** Node v24: `Readable.from` defaults every iterable to object mode. */
describe('Readable.from(iter, options?)', () => {
  function drainObjectMode<T>(r: Readable): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const out: T[] = [];
      r.on('data', (chunk) => out.push(chunk as T));
      r.on('end', () => resolve(out));
      r.on('error', reject);
    });
  }

  function settleFrom<T>(promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Readable.from never settled: ${label}`)), 250),
      ),
    ]);
  }

  it('defaults an iterable of Buffers to object mode and preserves entries', async () => {
    const first = Buffer.from('a');
    const second = Buffer.from('b');
    const r = Readable.from([first, second]);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(1);
    const out = await drainObjectMode<Buffer>(r);
    expect(out).toEqual([first, second]);
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(second);
  });

  it('uses object mode for an iterable of plain objects', async () => {
    const r = Readable.from([{ a: 1 }, { a: 2 }]);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(1);
    const out = await drainObjectMode<{ a: number }>(r);
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it.each(['', 'hello', 'hé'])('treats bare string %j as one object-mode chunk', async (text) => {
    const r = Readable.from(text);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(16);
    await expect(drainObjectMode<unknown>(r)).resolves.toEqual([text]);
  });

  it('treats a bare Buffer as one object-mode chunk by identity', async () => {
    const input = Buffer.from('ab');
    const r = Readable.from(input);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(16);
    const out = await drainObjectMode<unknown>(r);
    expect(out).toEqual([input]);
    expect(out[0]).toBe(input);
  });

  it('treats a bare empty Buffer as one object-mode chunk by identity', async () => {
    const input = Buffer.alloc(0);
    const r = Readable.from(input);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(16);
    const out = await drainObjectMode<unknown>(r);
    expect(out).toEqual([input]);
    expect(out[0]).toBe(input);
  });

  it.each([
    { label: 'false', objectMode: false },
    { label: 'undefined', objectMode: undefined },
    { label: 'null', objectMode: null },
  ])('keeps a bare non-ASCII string atomic with objectMode=$label', async ({ objectMode }) => {
    const r = Readable.from('hé', { objectMode } as unknown as ReadableOptions);
    expect(r.readableObjectMode).toBe(false);
    expect(r.readableHighWaterMark).toBe(65_536);
    const out = await drainObjectMode<unknown>(r);
    expect(out).toHaveLength(1);
    expect(Buffer.isBuffer(out[0])).toBe(true);
    expect(Buffer.from(out[0] as Uint8Array).toString('hex')).toBe('68c3a9');
  });

  it.each([
    { label: 'false', objectMode: false },
    { label: 'undefined', objectMode: undefined },
    { label: 'null', objectMode: null },
  ])('keeps a bare Buffer atomic with objectMode=$label', async ({ objectMode }) => {
    const input = Buffer.from([1, 2]);
    const r = Readable.from(input, { objectMode } as unknown as ReadableOptions);
    expect(r.readableObjectMode).toBe(false);
    expect(r.readableHighWaterMark).toBe(65_536);
    const out = await drainObjectMode<unknown>(r);
    expect(out).toEqual([input]);
    expect(out[0]).toBe(input);
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

  it.each([
    { label: 'undefined', value: undefined, expected: false },
    { label: 'null', value: null, expected: false },
    { label: 'false', value: false, expected: false },
    { label: 'true', value: true, expected: true },
  ])('lets an own objectMode=$label overwrite the generic default', ({ value, expected }) => {
    const options = { objectMode: value } as unknown as ReadableOptions;
    const r = Readable.from([Buffer.from('x')], options);
    expect(r.readableObjectMode).toBe(expected);
    expect(r.readableHighWaterMark).toBe(1);
    r.destroy();
  });

  it('uses normal byte HWM when a special string explicitly overwrites objectMode', () => {
    const r = Readable.from('x', { objectMode: undefined });
    expect(r.readableObjectMode).toBe(false);
    expect(r.readableHighWaterMark).toBe(65_536);
    r.destroy();
  });

  it('passes highWaterMark through from options', () => {
    const r = Readable.from([{ a: 1 }], { highWaterMark: 7 });
    expect(r.readableHighWaterMark).toBe(7);
  });

  it('passes a special string highWaterMark through from options', () => {
    const r = Readable.from('x', { highWaterMark: 3 });
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(3);
    r.destroy();
  });

  it('lets explicit highWaterMark undefined overwrite the generic HWM=1 default', () => {
    const r = Readable.from(['x'], { highWaterMark: undefined });
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(16);
    r.destroy();
  });

  it.each([
    { label: 'generic iterable', input: ['x'] as Iterable<unknown> },
    { label: 'special string', input: 'x' as Iterable<unknown> },
  ])('lets highWaterMark null reach the normal default for a $label', ({ input }) => {
    const r = Readable.from(input, { highWaterMark: null } as unknown as ReadableOptions);
    expect(r.readableHighWaterMark).toBe(16);
    r.destroy();
  });

  it('does not advance a sync iterator before readable demand', () => {
    let nexts = 0;
    const next = vi.fn((): IteratorResult<string> => {
      nexts += 1;
      if (nexts === 1) return { value: 'x', done: false };
      if (nexts === 2) return { value: undefined, done: true };
      throw new Error('unexpected third sync next');
    });
    const source = {
      [Symbol.iterator](): Iterator<string> {
        return { next };
      },
    };

    const r = Readable.from(source);
    expect(next).not.toHaveBeenCalled();
    r.read(0);
    expect(next).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('makes flowing progress and reaches EOF with generic highWaterMark 0', async () => {
    let nexts = 0;
    const source = {
      [Symbol.iterator](): Iterator<string> {
        return {
          next(): IteratorResult<string> {
            nexts += 1;
            return nexts === 1 ? { value: 'x', done: false } : { value: undefined, done: true };
          },
        };
      },
    };
    const r = Readable.from(source, { highWaterMark: 0 });

    await expect(settleFrom(drainObjectMode<string>(r), 'flowing HWM 0')).resolves.toEqual(['x']);
    expect({ nexts, ended: r.readableEnded, length: r.readableLength }).toEqual({
      nexts: 2,
      ended: true,
      length: 0,
    });
  });

  it.each([
    { label: 'read()', size: undefined },
    { label: 'read(1)', size: 1 },
  ])(
    'makes paused $label progress and reaches EOF with generic highWaterMark 0',
    async ({ size }) => {
      let nexts = 0;
      const source = {
        [Symbol.iterator](): Iterator<string> {
          return {
            next(): IteratorResult<string> {
              nexts += 1;
              return nexts === 1 ? { value: 'x', done: false } : { value: undefined, done: true };
            },
          };
        },
      };
      const r = Readable.from(source, { highWaterMark: 0 });
      let ended = false;
      r.on('end', () => {
        ended = true;
      });

      expect(r.read(size)).toBe('x');
      expect(r.read(size)).toBeNull();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({
        nexts,
        ended,
        stateEnded: r._readableState.ended,
        length: r.readableLength,
      }).toEqual({
        nexts: 2,
        ended: true,
        stateEnded: true,
        length: 0,
      });
    },
  );

  it('does not advance an async iterator before readable demand', () => {
    let nexts = 0;
    const next = vi.fn(async (): Promise<IteratorResult<string>> => {
      nexts += 1;
      if (nexts === 1) return { value: 'x', done: false };
      if (nexts === 2) return { value: undefined, done: true };
      throw new Error('unexpected third async next');
    });
    const source = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        return { next };
      },
    };

    const r = Readable.from(source);
    expect(next).not.toHaveBeenCalled();
    r.read(0);
    expect(next).toHaveBeenCalledTimes(1);
    r.destroy();
  });

  it('makes async flowing progress and reaches EOF with generic highWaterMark 0', async () => {
    let nexts = 0;
    const source = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        return {
          async next(): Promise<IteratorResult<string>> {
            nexts += 1;
            return nexts === 1 ? { value: 'x', done: false } : { value: undefined, done: true };
          },
        };
      },
    };
    const r = Readable.from(source, { highWaterMark: 0 });

    await expect(settleFrom(drainObjectMode<string>(r), 'async flowing HWM 0')).resolves.toEqual([
      'x',
    ]);
    expect({ nexts, ended: r.readableEnded, length: r.readableLength }).toEqual({
      nexts: 2,
      ended: true,
      length: 0,
    });
  });

  it.each([
    { label: 'read()', size: undefined },
    { label: 'read(1)', size: 1 },
  ])(
    'makes async paused $label progress and reaches EOF with generic highWaterMark 0',
    async ({ size }) => {
      let nexts = 0;
      const source = {
        [Symbol.asyncIterator](): AsyncIterator<string> {
          return {
            async next(): Promise<IteratorResult<string>> {
              nexts += 1;
              return nexts === 1 ? { value: 'x', done: false } : { value: undefined, done: true };
            },
          };
        },
      };
      const r = Readable.from(source, { highWaterMark: 0 });

      expect(r.read(size)).toBeNull();
      expect(nexts).toBe(1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(r.read(size)).toBe('x');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(r.read(size)).toBeNull();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect({ nexts, stateEnded: r._readableState.ended, length: r.readableLength }).toEqual({
        nexts: 2,
        stateEnded: true,
        length: 0,
      });
      r.destroy();
    },
  );

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
    expect(r.readableHighWaterMark).toBe(1);
    const out = await drainObjectMode<number>(r);
    expect(out).toEqual([1, 2, 3]);
  });

  it('defaults a bare Uint8Array iterable to object-mode numeric entries', async () => {
    const r = Readable.from(new Uint8Array([1, 2, 3]));
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(1);
    await expect(drainObjectMode<number>(r)).resolves.toEqual([1, 2, 3]);
  });

  it('defaults an iterable of Uint8Arrays to object mode', async () => {
    const first = new Uint8Array([1, 2]);
    const second = Buffer.from([3]);
    const r = Readable.from([first, second]);
    expect(r.readableObjectMode).toBe(true);
    expect(r.readableHighWaterMark).toBe(1);
    const out = await drainObjectMode<Uint8Array>(r);
    expect(out).toEqual([first, second]);
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(second);
  });

  it('fromWeb preserves web-stream chunk boundaries as byte-mode data', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x61, 0x61]));
        controller.enqueue(new Uint8Array([0x62, 0x62]));
        controller.close();
      },
    });

    const r = Readable.fromWeb(stream);
    expect(r.readableObjectMode).toBe(false);
    const out = await drainObjectMode<Uint8Array>(r);

    expect(out.map((chunk) => Buffer.from(chunk).toString('utf8'))).toEqual(['aa', 'bb']);
    expect(out.every((chunk) => Buffer.isBuffer(chunk))).toBe(true);
  });

  it('fromWeb converts default-stream string chunks to Buffers in byte mode', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('é');
        controller.close();
      },
    });

    const r = Readable.fromWeb(stream);
    const out = await drainObjectMode<unknown>(r);

    expect(r.readableObjectMode).toBe(false);
    expect(out).toHaveLength(1);
    expect(Buffer.isBuffer(out[0])).toBe(true);
    expect(Buffer.from(out[0] as Uint8Array).toString('hex')).toBe('c3a9');
    expect(String(out[0])).toBe('é');
  });

  it('fromWeb preserves default-stream object chunks when objectMode is true', async () => {
    const first = { a: 1 };
    const stream = new ReadableStream<{ a: number }>({
      start(controller) {
        controller.enqueue(first);
        controller.close();
      },
    });

    const r = Readable.fromWeb(stream, { objectMode: true });
    const out = await drainObjectMode<unknown>(r);

    expect(r.readableObjectMode).toBe(true);
    expect(out).toEqual([first]);
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
    const stream = Readable.toWeb(Readable.from(['x'], { objectMode: true }));
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
    const stream = Readable.toWeb(Readable.from(['x'], { objectMode: true }), {
      strategy: { size },
    });

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
