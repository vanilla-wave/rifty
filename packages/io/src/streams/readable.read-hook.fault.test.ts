import { describe, expect, it } from 'vitest';
import { Buffer } from '../buffer.ts';
import { NotImplementedError } from '../errors.ts';
import { Duplex } from './duplex.ts';
import { Readable } from './readable.ts';
import { Writable } from './writable.ts';

type ReadHook = (this: Readable, size: number) => void;
type ReadableWithHook = Readable & { _read: ReadHook };

function withReadHook(readable: Readable): ReadableWithHook {
  return readable as ReadableWithHook;
}

const filteredChunks = [
  { label: 'undefined', chunk: undefined },
  { label: 'empty string', chunk: '' },
  { label: 'empty bytes', chunk: new Uint8Array(0) },
] as const;

const coreCandidates = [
  { label: 'undefined', chunk: undefined, byteHex: null },
  { label: 'empty string', chunk: '', byteHex: null },
  { label: 'empty bytes', chunk: new Uint8Array(0), byteHex: null },
  { label: 'string', chunk: 'x', byteHex: '78' },
  { label: 'plain bytes', chunk: new Uint8Array([7]), byteHex: '07' },
] as const;

type CoreConsumer = 'read()' | 'read(1)' | 'readable' | 'data';

function chunkTag(chunk: unknown): string {
  if (chunk === null) return 'null';
  if (chunk === undefined) return 'undefined';
  if (typeof chunk === 'string') return `string:${chunk}`;
  if (chunk instanceof Uint8Array) return `bytes:${Array.from(chunk).join('.')}`;
  return `${typeof chunk}:${String(chunk)}`;
}

function exactChunkTag(chunk: unknown): string {
  if (chunk === null) return 'null';
  if (chunk === undefined) return 'undefined';
  if (typeof chunk === 'string') return `string:${chunk}`;
  if (Buffer.isBuffer(chunk)) {
    return `buffer:${Buffer.from(chunk as Uint8Array).toString('hex')}`;
  }
  if (chunk instanceof Uint8Array) return `uint8:${Array.from(chunk).join('.')}`;
  return `${typeof chunk}:${String(chunk)}`;
}

function expectedCoreTags(
  candidate: (typeof coreCandidates)[number],
  objectMode: boolean,
  consumer: CoreConsumer,
): string[] {
  const direct = consumer === 'read()' || consumer === 'read(1)';
  if (objectMode) {
    const values = [exactChunkTag(candidate.chunk), 'uint8:9'];
    return direct ? [...values, 'null'] : values;
  }
  if (candidate.byteHex === null) {
    return direct ? ['null', 'buffer:09', 'null'] : ['buffer:09'];
  }
  if (consumer === 'readable') return [`buffer:${candidate.byteHex}09`];
  const values = [`buffer:${candidate.byteHex}`, 'buffer:09'];
  return direct ? [...values, 'null'] : values;
}

function phase(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type HookPlacement = 'own enumerable' | 'own non-enumerable' | 'inherited';

function hookGetterOptions(
  hooks: readonly string[],
  placement: HookPlacement,
): { options: Record<string, unknown>; hits: Record<string, number> } {
  const hits = Object.fromEntries(hooks.map((hook) => [hook, 0]));
  const owner = placement === 'inherited' ? {} : Object.create(null);
  for (const hook of hooks) {
    Object.defineProperty(owner, hook, {
      configurable: true,
      enumerable: placement === 'own enumerable',
      get(): () => void {
        hits[hook] = (hits[hook] ?? 0) + 1;
        return (): void => {};
      },
    });
  }
  return {
    options: placement === 'inherited' ? Object.create(owner) : owner,
    hits,
  };
}

function configGetterOptions(
  keys: readonly string[],
  placement: HookPlacement,
): { options: Record<string, unknown>; observed: string[] } {
  const observed: string[] = [];
  const owner = placement === 'inherited' ? {} : Object.create(null);
  for (const key of keys) {
    Object.defineProperty(owner, key, {
      configurable: true,
      enumerable: placement === 'own enumerable',
      get(): undefined {
        observed.push(key);
        return undefined;
      },
    });
  }
  return {
    options: placement === 'inherited' ? Object.create(owner) : owner,
    observed,
  };
}

function webReadableFixture(): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller): void {
      controller.enqueue(undefined);
      controller.enqueue('');
      controller.enqueue(new Uint8Array(0));
      controller.enqueue(new Uint8Array([9]));
      controller.close();
    },
  });
}

function instrumentedWebReader(values: readonly unknown[]): {
  stream: ReadableStream<unknown>;
  readCalls: () => number;
  maxPending: () => number;
} {
  const web = new ReadableStream<unknown>({
    start(controller): void {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });
  const getReader = web.getReader.bind(web);
  let calls = 0;
  let pending = 0;
  let maxPending = 0;
  Object.defineProperty(web, 'getReader', {
    value: (): ReadableStreamDefaultReader<unknown> => {
      const reader = getReader();
      return {
        closed: reader.closed,
        read(): Promise<ReadableStreamReadResult<unknown>> {
          calls += 1;
          pending += 1;
          maxPending = Math.max(maxPending, pending);
          return reader.read().finally(() => {
            pending -= 1;
          });
        },
        cancel(reason?: unknown): Promise<void> {
          return reader.cancel(reason);
        },
        releaseLock(): void {
          reader.releaseLock();
        },
      } as ReadableStreamDefaultReader<unknown>;
    },
  });
  return {
    stream: web,
    readCalls: () => calls,
    maxPending: () => maxPending,
  };
}

function fromWebFixture(adapter: 'Readable' | 'Duplex', objectMode: boolean): Readable {
  const readable = webReadableFixture();
  return adapter === 'Readable'
    ? Readable.fromWeb(readable, { objectMode })
    : Duplex.fromWeb({ readable, writable: new WritableStream() }, { objectMode });
}

async function consumePaused(source: Readable): Promise<unknown[]> {
  const seen: unknown[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    source.read(0);
    await phase();
    for (let drain = 0; drain < 8 && source.readableLength > 0; drain += 1) {
      seen.push(source.read(1));
    }
    if (source.readableLength > 0) throw new Error('paused consumer exceeded drain budget');
    if (source._readableState.ended && source.readableLength === 0) break;
  }
  await phase();
  return seen;
}

describe('Readable _read hook contract', () => {
  it('dispatches a subclass prototype hook with the high-water mark', () => {
    const calls: number[] = [];
    class Source extends Readable {}
    Object.defineProperty(Source.prototype, '_read', {
      configurable: true,
      value(this: Readable, size: number): void {
        calls.push(size);
        this.push('subclass');
        this.push(null);
      },
      writable: true,
    });

    const source = new Source({ objectMode: true, highWaterMark: 3 });
    expect(source.read(0)).toBeNull();
    expect(calls).toEqual([3]);
    expect(source.read()).toBe('subclass');
  });

  it('assigns the constructor option as the own hook ahead of a subclass hook', () => {
    const calls: string[] = [];
    class Source extends Readable {}
    Object.defineProperty(Source.prototype, '_read', {
      configurable: true,
      value(): void {
        calls.push('prototype');
      },
      writable: true,
    });
    const optionRead: ReadHook = (): void => {
      calls.push('option');
    };

    const source = new Source({ read: optionRead });
    expect(Object.hasOwn(source, '_read')).toBe(true);
    expect(withReadHook(source)._read).toBe(optionRead);
    source.read(0);
    expect(calls).toEqual(['option']);
  });

  it('looks up an own hook installed after construction', () => {
    const calls: string[] = [];
    const source = new Readable({
      objectMode: true,
      read(): void {
        calls.push('option');
      },
    });

    source.read(0);
    source.push('release');
    withReadHook(source)._read = (): void => {
      calls.push('late');
    };
    source.read(0);

    expect(calls).toEqual(['option', 'late']);
  });

  it('ignores a hostile thenable return and keeps no-push demand latched', () => {
    let calls = 0;
    let thenReads = 0;
    const hostile = {
      get then(): never {
        thenReads += 1;
        throw new Error('the _read return value was observed');
      },
    };
    const source = new Readable({
      read() {
        calls += 1;
        return hostile;
      },
    });

    source.read(0);
    const readingAfterFirstCall = source._readableState.reading;
    source.read(0);

    expect({
      calls,
      thenReads,
      readingAfterFirstCall,
      reading: source._readableState.reading,
    }).toEqual({ calls: 1, thenReads: 0, readingAfterFirstCall: true, reading: true });
  });

  it('lets push(data) release the latch for the next demand', () => {
    let calls = 0;
    const source = new Readable({
      objectMode: true,
      read(): void {
        calls += 1;
        if (calls === 1) this.push('first');
      },
    });

    source.read(0);
    expect({ calls, reading: source._readableState.reading }).toEqual({
      calls: 1,
      reading: false,
    });
    source.read(0);
    expect({ calls, reading: source._readableState.reading }).toEqual({
      calls: 2,
      reading: true,
    });
  });

  it('lets push(null) release the latch', () => {
    const source = new Readable({ read(): void {} });
    source.read(0);
    expect(source._readableState.reading).toBe(true);

    source.push(null);

    expect(source._readableState.reading).toBe(false);
    expect(source._readableState.ended).toBe(true);
  });

  it('does not bridge a rejected return into stream destruction', async () => {
    const rejection = { source: 'returned-promise' };
    let caught: unknown;
    let emitted: unknown;
    let releaseCatch!: () => void;
    const rejectionCaught = new Promise<void>((resolve) => {
      releaseCatch = resolve;
    });
    const source = new Readable({
      read() {
        const returned = Promise.reject(rejection);
        void returned.catch((error: unknown) => {
          caught = error;
          releaseCatch();
        });
        return returned;
      },
    });
    source.on('error', (error) => {
      emitted = error;
    });

    source.read(0);
    await rejectionCaught;
    await Promise.resolve();

    expect(caught).toBe(rejection);
    expect(emitted).toBeUndefined();
    expect(source.destroyed).toBe(false);
    expect(source._readableState.reading).toBe(true);
  });

  it('destroys on a synchronous raw throw without throwing from read()', async () => {
    const thrown = { source: 'sync-throw' };
    let emitted: unknown;
    const source = new Readable({
      read(): void {
        throw thrown;
      },
    });
    source.on('error', (error) => {
      emitted = error;
    });

    expect(() => source.read(0)).not.toThrow();
    await Promise.resolve();

    expect(emitted).toBe(thrown);
    expect(source._readableState.errored).toBe(thrown);
    expect(source.destroyed).toBe(true);
    expect(source._readableState.reading).toBe(true);
  });

  it('delivers a push after an await and reaches EOF without a second read', async () => {
    let calls = 0;
    const seen: unknown[] = [];
    const source = new Readable({
      objectMode: true,
      async read() {
        calls += 1;
        await Promise.resolve();
        this.push('async');
        this.push(null);
      },
    });
    const ended = new Promise<void>((resolve, reject) => {
      source.on('data', (chunk) => seen.push(chunk));
      source.on('end', () => resolve());
      source.on('error', reject);
    });

    await ended;

    expect(seen).toEqual(['async']);
    expect(calls).toBe(1);
    expect(source.readableEnded).toBe(true);
  });

  it('keeps the bare hook loud for direct and consumer-driven demand', async () => {
    const direct = new Readable();
    let directError: unknown;
    try {
      withReadHook(direct)._read(1);
    } catch (error) {
      directError = error;
    }
    expect(directError).toMatchObject({
      code: 'ERR_METHOD_NOT_IMPLEMENTED',
      message: 'The _read() method is not implemented',
    });

    const consumed = new Readable();
    let emitted: unknown;
    consumed.on('error', (error) => {
      emitted = error;
    });
    expect(consumed.read(0)).toBeNull();
    await Promise.resolve();

    expect(emitted).toMatchObject({
      code: 'ERR_METHOD_NOT_IMPLEMENTED',
      message: 'The _read() method is not implemented',
    });
    expect(consumed.destroyed).toBe(true);
  });

  it('owns fromWeb demand and ignores an extra read option like Node', async () => {
    let controller!: ReadableStreamDefaultController<string>;
    const web = new ReadableStream<string>({
      start(next): void {
        controller = next;
      },
    });
    let customReads = 0;
    const options = {
      objectMode: true,
      read(): void {
        customReads += 1;
      },
    };
    const source = Readable.fromWeb(web, options);
    const seen: unknown[] = [];
    const ended = new Promise<void>((resolve, reject) => {
      source.on('data', (chunk) => seen.push(chunk));
      source.on('end', () => resolve());
      source.on('error', reject);
    });

    await Promise.resolve();
    const ownsHook = Object.hasOwn(source, '_read');
    const usesCustomHook = withReadHook(source)._read === options.read;
    controller.enqueue('web');
    controller.close();
    await ended;

    expect({ customReads, ownsHook, usesCustomHook, seen }).toEqual({
      customReads: 0,
      ownsHook: true,
      usesCustomHook: false,
      seen: ['web'],
    });
  });
});

describe('Readable _read hook siblings', () => {
  it.each([
    { label: 'object mode', objectMode: true, expected: ['undefined', '9'] },
    { label: 'byte mode', objectMode: false, expected: ['9'] },
  ])('Duplex.fromWeb makes progress past undefined in $label', async ({ objectMode, expected }) => {
    const readable = new ReadableStream<unknown>({
      start(controller): void {
        controller.enqueue(undefined);
        controller.enqueue(new Uint8Array([9]));
        controller.close();
      },
    });
    const duplex = Duplex.fromWeb({ readable, writable: new WritableStream() }, { objectMode });
    const seen: string[] = [];
    let ended = false;
    let emittedError: unknown;
    duplex.on('data', (chunk) => {
      seen.push(chunk === undefined ? 'undefined' : Array.from(chunk as Uint8Array).join('.'));
    });
    duplex.on('end', () => {
      ended = true;
    });
    duplex.on('error', (error) => {
      emittedError = error;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const reading = duplex._readableState.reading;
    if (!ended) duplex.destroy();

    expect({ seen, ended, emittedError, reading }).toEqual({
      seen: expected,
      ended: true,
      emittedError: undefined,
      reading: false,
    });
  });
});

describe('Readable filtered chunk ownership', () => {
  it.each(
    coreCandidates.flatMap((candidate) =>
      [true, false].flatMap((objectMode) =>
        (['read()', 'read(1)', 'readable', 'data'] as const).map((consumer) => ({
          label: `${candidate.label} / ${objectMode ? 'object' : 'byte'} / ${consumer}`,
          candidate,
          objectMode,
          consumer,
        })),
      ),
    ),
  )(
    '$label follows one admission and demand contract',
    async ({ candidate, objectMode, consumer }) => {
      const marker = new Uint8Array([9]);
      const produced = [candidate.chunk, marker, null];
      const overflow = new Error('unexpected fourth source read');
      let calls = 0;
      const source = new Readable({
        objectMode,
        read(): void {
          const index = calls;
          calls += 1;
          if (index >= produced.length) throw overflow;
          this.push(produced[index]);
        },
      });
      const seen: unknown[] = [];
      let ended = false;
      let emittedError: unknown;
      let consumerOverflow = false;
      source.on('end', () => {
        ended = true;
      });
      source.on('error', (error) => {
        emittedError = error;
      });

      if (consumer === 'read()' || consumer === 'read(1)') {
        const size = consumer === 'read(1)' ? 1 : undefined;
        seen.push(source.read(size), source.read(size), source.read(size));
      } else if (consumer === 'readable') {
        source.on('readable', () => {
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const value = source.read();
            if (value === null) return;
            seen.push(value);
          }
          consumerOverflow = true;
          source.destroy();
        });
      } else {
        source.on('data', (value) => seen.push(value));
      }
      await phase();
      if (!ended) source.destroy();

      expect(seen.map(exactChunkTag)).toEqual(expectedCoreTags(candidate, objectMode, consumer));
      if (objectMode) expect(seen[0]).toBe(candidate.chunk);
      expect({
        calls,
        ended,
        emittedError,
        consumerOverflow,
        stateEnded: source._readableState.ended,
        reading: source._readableState.reading,
        length: source.readableLength,
        buffered: source._readableState.buffer.length,
      }).toEqual({
        calls: 3,
        ended: true,
        emittedError: undefined,
        consumerOverflow: false,
        stateEnded: true,
        reading: false,
        length: 0,
        buffered: 0,
      });
    },
  );

  it.each([
    { label: 'byte string', objectMode: false, chunk: 'é', hex: 'c3a9', same: false, length: 2 },
    {
      label: 'byte plain Uint8Array',
      objectMode: false,
      chunk: new Uint8Array([7]),
      hex: '07',
      same: false,
      length: 1,
    },
    {
      label: 'byte Buffer',
      objectMode: false,
      chunk: Buffer.from([7]),
      hex: '07',
      same: true,
      length: 1,
    },
    { label: 'object string', objectMode: true, chunk: 'é', hex: null, same: true, length: 1 },
    {
      label: 'object plain Uint8Array',
      objectMode: true,
      chunk: new Uint8Array([7]),
      hex: null,
      same: true,
      length: 1,
    },
    {
      label: 'object Buffer',
      objectMode: true,
      chunk: Buffer.from([7]),
      hex: null,
      same: true,
      length: 1,
    },
  ])(
    'normalizes $label exactly once at push admission',
    ({ objectMode, chunk, hex, same, length }) => {
      const source = new Readable({ objectMode, read(): void {} });

      expect(source.push(chunk)).toBe(true);
      const buffered = source._readableState.buffer[0];

      expect({ length: source.readableLength, isBuffer: Buffer.isBuffer(buffered) }).toEqual({
        length,
        isBuffer: objectMode ? Buffer.isBuffer(chunk) : true,
      });
      if (hex !== null) expect(Buffer.from(buffered as Uint8Array).toString('hex')).toBe(hex);
      expect(buffered === chunk).toBe(same);
    },
  );

  it.each(filteredChunks)(
    'orders the $label byte no-op around latch, backpressure, EOF, and destroy',
    async ({ chunk }) => {
      const overflow = new Error('unexpected byte-noop refill');
      let emptyCalls = 0;
      let emptyError: unknown;
      const empty = new Readable({
        highWaterMark: 0,
        read(): void {
          emptyCalls += 1;
          if (emptyCalls > 1) throw overflow;
        },
      });
      empty.on('error', (error) => {
        emptyError = error;
      });
      empty.read(0);
      const emptyReturn = empty.push(chunk);
      const emptyReading = empty._readableState.reading;

      const full = new Readable({ highWaterMark: 1, read(): void {} });
      full.push(new Uint8Array([1]));
      full._readableState.reading = true;
      const fullReturn = full.push(chunk);

      const ended = new Readable({ read(): void {} });
      let endedError: unknown;
      ended.on('error', (error) => {
        endedError = error;
      });
      ended.push(null);
      const endedReturn = ended.push(chunk);

      const destroyed = new Readable({ highWaterMark: 0, read(): void {} });
      destroyed.destroy();
      await Promise.resolve();
      const destroyedReturn = destroyed.push(chunk);
      await phase();

      expect({
        emptyReturn,
        emptyCalls,
        emptyError,
        emptyReading,
        emptyLength: empty.readableLength,
        fullReturn,
        fullReading: full._readableState.reading,
        fullLength: full.readableLength,
        endedReturn,
        endedError,
        destroyedReturn,
      }).toEqual({
        emptyReturn: true,
        emptyCalls: 1,
        emptyError: undefined,
        emptyReading: false,
        emptyLength: 0,
        fullReturn: false,
        fullReading: false,
        fullLength: 1,
        endedReturn: false,
        endedError: undefined,
        destroyedReturn: true,
      });
    },
  );

  it.each([
    ...filteredChunks.map(({ label, chunk }) => ({
      label: `${label} in object mode`,
      chunk,
      objectMode: true,
    })),
    { label: 'non-empty bytes in byte mode', chunk: new Uint8Array([9]), objectMode: false },
  ])('reports Node-coded push-after-EOF for $label', async ({ chunk, objectMode }) => {
    const source = new Readable({ objectMode, read(): void {} });
    let emittedError: unknown;
    source.on('error', (error) => {
      emittedError = error;
    });
    source.push(null);

    const returned = source.push(chunk);
    await phase();

    expect(returned).toBe(false);
    expect(emittedError).toMatchObject({
      code: 'ERR_STREAM_PUSH_AFTER_EOF',
      message: 'stream.push() after EOF',
    });
  });
});

describe('WHATWG adapter filtered pull ownership', () => {
  it.each(
    (['Readable', 'Duplex'] as const).flatMap((adapter) =>
      [true, false].flatMap((objectMode) =>
        (['paused', 'flowing'] as const).map((consumption) => ({
          label: `${adapter} ${objectMode ? 'object' : 'byte'} ${consumption}`,
          adapter,
          objectMode,
          consumption,
        })),
      ),
    ),
  )(
    '$label continues the same pull past every byte no-op',
    async ({ adapter, objectMode, consumption }) => {
      const source = fromWebFixture(adapter, objectMode);
      const seen: unknown[] = [];
      let ended = false;
      let emittedError: unknown;
      source.on('end', () => {
        ended = true;
      });
      source.on('error', (error) => {
        emittedError = error;
      });

      if (consumption === 'flowing') {
        source.on('data', (chunk) => seen.push(chunk));
        await phase();
      } else {
        seen.push(...(await consumePaused(source)));
      }
      if (!ended) source.destroy();

      expect(seen.map(chunkTag)).toEqual(
        objectMode ? ['undefined', 'string:', 'bytes:', 'bytes:9'] : ['bytes:9'],
      );
      expect({
        ended,
        emittedError,
        reading: source._readableState.reading,
        length: source.readableLength,
      }).toEqual({
        ended: true,
        emittedError: undefined,
        reading: false,
        length: 0,
      });
    },
  );

  it.each(
    (['Readable', 'Duplex'] as const).flatMap((adapter) => [
      {
        label: `${adapter} / HWM 1 / untouched flowing state`,
        adapter,
        highWaterMark: 1,
        pause: false,
      },
      { label: `${adapter} / HWM 1 / explicit pause`, adapter, highWaterMark: 1, pause: true },
      {
        label: `${adapter} / HWM 0 / untouched flowing state`,
        adapter,
        highWaterMark: 0,
        pause: false,
      },
    ]),
  )(
    '$label pulls only from consumer demand and refills one slot',
    async ({ adapter, highWaterMark, pause }) => {
      const instrumented = instrumentedWebReader([new Uint8Array([1]), new Uint8Array([2])]);
      const source =
        adapter === 'Readable'
          ? Readable.fromWeb(instrumented.stream, { highWaterMark })
          : Duplex.fromWeb(
              { readable: instrumented.stream, writable: new WritableStream() },
              { highWaterMark },
            );
      if (pause) source.pause();
      await phase();

      expect({
        coldCalls: instrumented.readCalls(),
        coldLength: source.readableLength,
        flowing: source._readableState.flowing,
        dataListeners: source.listenerCount('data'),
        readableListeners: source.listenerCount('readable'),
      }).toEqual({
        coldCalls: 0,
        coldLength: 0,
        flowing: pause ? false : null,
        dataListeners: 0,
        readableListeners: 0,
      });

      source.read(0);
      await phase();
      const firstSnapshot = { calls: instrumented.readCalls(), length: source.readableLength };
      const first = source.read(1);
      await phase();
      const secondSnapshot = { calls: instrumented.readCalls(), length: source.readableLength };
      const second = source.read(1);
      await phase();

      expect({
        firstSnapshot,
        first: exactChunkTag(first),
        secondSnapshot,
        second: exactChunkTag(second),
        finalCalls: instrumented.readCalls(),
        maxPending: instrumented.maxPending(),
        ended: source._readableState.ended,
        endEmitted: source.readableEnded,
        flowing: source._readableState.flowing,
        dataListeners: source.listenerCount('data'),
        readableListeners: source.listenerCount('readable'),
      }).toEqual({
        firstSnapshot: { calls: 1, length: 1 },
        first: 'buffer:01',
        secondSnapshot: { calls: 2, length: 1 },
        second: 'buffer:02',
        finalCalls: 3,
        maxPending: 1,
        ended: true,
        endEmitted: true,
        flowing: pause ? false : null,
        dataListeners: 0,
        readableListeners: 0,
      });
    },
  );

  it.each(['Readable', 'Duplex'] as const)(
    '%s keeps one reader.read pending across repeated demand',
    async (adapter) => {
      let calls = 0;
      let settleRead!: (result: ReadableStreamReadResult<unknown>) => void;
      const pendingRead = new Promise<ReadableStreamReadResult<unknown>>((resolve) => {
        settleRead = resolve;
      });
      const overflow = new Error('unexpected third reader.read');
      const stream = new ReadableStream<unknown>();
      Object.defineProperty(stream, 'getReader', {
        value: () =>
          ({
            read(): Promise<ReadableStreamReadResult<unknown>> {
              calls += 1;
              if (calls === 1) return pendingRead;
              if (calls === 2) return Promise.resolve({ done: true, value: undefined });
              return Promise.reject(overflow);
            },
            cancel: async (): Promise<void> => {},
            releaseLock(): void {},
          }) as ReadableStreamDefaultReader<unknown>,
      });
      const source =
        adapter === 'Readable'
          ? Readable.fromWeb(stream, { highWaterMark: 1 })
          : Duplex.fromWeb(
              { readable: stream, writable: new WritableStream() },
              { highWaterMark: 1 },
            );
      let emittedError: unknown;
      source.on('error', (error) => {
        emittedError = error;
      });

      expect(calls).toBe(0);
      source.read(0);
      source.read(0);
      expect(calls).toBe(1);

      settleRead({ done: false, value: new Uint8Array([1]) });
      await phase();
      expect({
        calls,
        length: source.readableLength,
        reading: source._readableState.reading,
        emittedError,
      }).toEqual({
        calls: 1,
        length: 1,
        reading: false,
        emittedError: undefined,
      });
      source.destroy();
    },
  );
});

describe('WHATWG adapters own their hooks', () => {
  it.each(
    (['own enumerable', 'own non-enumerable', 'inherited'] as const).map((placement) => ({
      placement,
    })),
  )('Readable.fromWeb ignores a read getter when it is $placement', ({ placement }) => {
    const { options, hits } = hookGetterOptions(['read'], placement);
    const source = Readable.fromWeb(
      new ReadableStream({ start: (controller) => controller.close() }),
      options,
    );
    source.on('error', () => {});
    source.destroy();

    expect(hits).toEqual({ read: 0 });
  });

  it.each(
    (['own enumerable', 'own non-enumerable', 'inherited'] as const).map((placement) => ({
      placement,
    })),
  )('Writable.fromWeb ignores hook getters when they are $placement', ({ placement }) => {
    const { options, hits } = hookGetterOptions(['write', 'writev', 'final', 'destroy'], placement);
    const target = Writable.fromWeb(new WritableStream(), options);
    target.on('error', () => {});
    target.destroy();

    expect(hits).toEqual({ write: 0, writev: 0, final: 0, destroy: 0 });
  });

  it.each(
    (['own enumerable', 'own non-enumerable', 'inherited'] as const).map((placement) => ({
      placement,
    })),
  )('Duplex.fromWeb ignores hook getters when they are $placement', ({ placement }) => {
    const { options, hits } = hookGetterOptions(
      ['read', 'write', 'writev', 'final', 'destroy'],
      placement,
    );
    const target = Duplex.fromWeb(
      {
        readable: new ReadableStream({ start: (controller) => controller.close() }),
        writable: new WritableStream(),
      },
      options,
    );
    target.on('error', () => {});
    target.destroy();

    expect(hits).toEqual({ read: 0, write: 0, writev: 0, final: 0, destroy: 0 });
  });

  it.each(
    [
      {
        adapter: 'Readable' as const,
        keys: ['highWaterMark', 'encoding', 'objectMode', 'signal'] as const,
      },
      {
        adapter: 'Writable' as const,
        keys: ['highWaterMark', 'decodeStrings', 'objectMode', 'signal'] as const,
      },
      {
        adapter: 'Duplex' as const,
        keys: [
          'allowHalfOpen',
          'objectMode',
          'encoding',
          'decodeStrings',
          'highWaterMark',
          'signal',
        ] as const,
      },
    ].flatMap(({ adapter, keys }) =>
      (['own enumerable', 'own non-enumerable', 'inherited'] as const).map((placement) => ({
        label: `${adapter} / ${placement}`,
        adapter,
        keys,
        placement,
      })),
    ),
  )('$label reads each config getter once in Node order', ({ adapter, keys, placement }) => {
    const { options, observed } = configGetterOptions(keys, placement);
    const target =
      adapter === 'Readable'
        ? Readable.fromWeb(
            new ReadableStream({ start: (controller) => controller.close() }),
            options,
          )
        : adapter === 'Writable'
          ? Writable.fromWeb(new WritableStream(), options)
          : Duplex.fromWeb(
              {
                readable: new ReadableStream({ start: (controller) => controller.close() }),
                writable: new WritableStream(),
              },
              options,
            );
    target.on('error', () => {});
    target.destroy();

    expect(observed).toEqual(keys);
  });

  it.each([
    { label: 'Readable', adapter: 'Readable', feature: 'stream.Readable.fromWeb.signal' },
    { label: 'Writable', adapter: 'Writable', feature: 'stream.Writable.fromWeb.signal' },
    { label: 'Duplex', adapter: 'Duplex', feature: 'stream.Duplex.fromWeb.signal' },
  ] as const)(
    '$label fromWeb keeps signal a loud terminal-lifecycle gap',
    ({ adapter, feature }) => {
      const signal = new AbortController().signal;
      let thrown: unknown;
      try {
        if (adapter === 'Readable') {
          Readable.fromWeb(new ReadableStream(), { signal } as never);
        } else if (adapter === 'Writable') {
          Writable.fromWeb(new WritableStream(), { signal } as never);
        } else {
          Duplex.fromWeb({ readable: new ReadableStream(), writable: new WritableStream() }, {
            signal,
          } as never);
        }
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(NotImplementedError);
      expect(thrown).toMatchObject({ feature });
    },
  );
});
