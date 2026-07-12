import { describe, expect, it } from 'vitest';
import { NotImplementedError } from '../errors.ts';
import { Duplex } from './duplex.ts';
import { Readable } from './readable.ts';
import { Writable } from './writable.ts';

type Adapter = 'Readable' | 'Writable' | 'Duplex';
type FromWebResult = Readable | Writable | Duplex;

interface AdapterContract {
  adapter: Adapter;
  feature: string;
  getterOrder: readonly string[];
  hwmErrorKey: string;
}

const adapters: readonly AdapterContract[] = [
  {
    adapter: 'Readable',
    feature: 'stream.Readable.fromWeb.signal',
    getterOrder: ['highWaterMark', 'encoding', 'objectMode', 'signal'],
    hwmErrorKey: 'highWaterMark',
  },
  {
    adapter: 'Writable',
    feature: 'stream.Writable.fromWeb.signal',
    getterOrder: ['highWaterMark', 'decodeStrings', 'objectMode', 'signal'],
    hwmErrorKey: 'highWaterMark',
  },
  {
    adapter: 'Duplex',
    feature: 'stream.Duplex.fromWeb.signal',
    getterOrder: [
      'allowHalfOpen',
      'objectMode',
      'encoding',
      'decodeStrings',
      'highWaterMark',
      'signal',
    ],
    hwmErrorKey: 'readableHighWaterMark',
  },
] as const;

const readableContract = adapters[0]!;
const writableContract = adapters[1]!;
const duplexContract = adapters[2]!;

function validSource(adapter: Adapter): unknown {
  if (adapter === 'Readable') return new ReadableStream();
  if (adapter === 'Writable') return new WritableStream();
  return { readable: new ReadableStream(), writable: new WritableStream() };
}

function invoke(
  adapter: Adapter,
  options: unknown = {},
  source = validSource(adapter),
): FromWebResult {
  if (adapter === 'Readable') {
    return Readable.fromWeb(source as ReadableStream<unknown>, options as never);
  }
  if (adapter === 'Writable') {
    return Writable.fromWeb(source as WritableStream<unknown>, options as never);
  }
  return Duplex.fromWeb(
    source as { readable: ReadableStream<unknown>; writable: WritableStream<unknown> },
    options as never,
  );
}

function dispose(stream: FromWebResult): void {
  stream.on('error', () => {});
  stream.destroy();
}

function capture(run: () => unknown): unknown {
  try {
    const result = run();
    if (result instanceof Readable || result instanceof Writable) dispose(result);
    return null;
  } catch (error) {
    return error;
  }
}

function expectNodeError(error: unknown, code: string, key?: string): void {
  expect(error).toBeInstanceOf(TypeError);
  expect(error).toMatchObject({ code });
  if (key !== undefined) expect((error as Error).message).toContain(key);
}

function inheritedGetterBag(
  keys: readonly string[],
  thrownKey?: string,
  marker?: unknown,
  observed: string[] = [],
): { options: Record<string, unknown>; observed: string[] } {
  const owner = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    Object.defineProperty(owner, key, {
      configurable: true,
      get(): undefined {
        observed.push(key);
        if (key === thrownKey) throw marker;
        return undefined;
      },
    });
  }
  return { options: Object.create(owner) as Record<string, unknown>, observed };
}

function hwmOf(adapter: Adapter, stream: FromWebResult): number | readonly [number, number] {
  if (adapter === 'Readable') return (stream as Readable).readableHighWaterMark;
  if (adapter === 'Writable') return (stream as Writable).writableHighWaterMark;
  const duplex = stream as Duplex;
  return [duplex.readableHighWaterMark, duplex.writableHighWaterMark] as const;
}

function acquisitionFixture(
  adapter: Adapter,
  observed: string[] = [],
): {
  source: unknown;
  calls: () => readonly number[];
  locked: () => readonly boolean[];
} {
  if (adapter === 'Readable') {
    const readable = new ReadableStream();
    const getReader = readable.getReader.bind(readable);
    let reads = 0;
    Object.defineProperty(readable, 'getReader', {
      value: () => {
        observed.push('acquire:reader');
        reads += 1;
        return getReader();
      },
    });
    return {
      source: readable,
      calls: () => [reads],
      locked: () => [readable.locked],
    };
  }
  if (adapter === 'Writable') {
    const writable = new WritableStream();
    const getWriter = writable.getWriter.bind(writable);
    let writes = 0;
    Object.defineProperty(writable, 'getWriter', {
      value: () => {
        observed.push('acquire:writer');
        writes += 1;
        return getWriter();
      },
    });
    return {
      source: writable,
      calls: () => [writes],
      locked: () => [writable.locked],
    };
  }
  const readable = new ReadableStream();
  const writable = new WritableStream();
  const getReader = readable.getReader.bind(readable);
  const getWriter = writable.getWriter.bind(writable);
  let reads = 0;
  let writes = 0;
  Object.defineProperty(readable, 'getReader', {
    value: () => {
      observed.push('acquire:reader');
      reads += 1;
      return getReader();
    },
  });
  Object.defineProperty(writable, 'getWriter', {
    value: () => {
      observed.push('acquire:writer');
      writes += 1;
      return getWriter();
    },
  });
  return {
    source: { readable, writable },
    calls: () => [reads, writes],
    locked: () => [readable.locked, writable.locked],
  };
}

function expectedCalls(adapter: Adapter, acquired: boolean): readonly number[] {
  if (adapter === 'Duplex') return acquired ? [1, 1] : [0, 0];
  return acquired ? [1] : [0];
}

function expectedLocks(adapter: Adapter, acquired: boolean): readonly boolean[] {
  if (adapter === 'Duplex') return acquired ? [true, true] : [false, false];
  return acquired ? [true] : [false];
}

function expectAcquisition(
  contract: Pick<AdapterContract, 'adapter'>,
  fixture: ReturnType<typeof acquisitionFixture>,
  acquired: boolean,
): void {
  expect(fixture.calls()).toEqual(expectedCalls(contract.adapter, acquired));
  expect(fixture.locked()).toEqual(expectedLocks(contract.adapter, acquired));
}

function acquisitionOrder(adapter: Adapter): readonly string[] {
  if (adapter === 'Readable') return ['acquire:reader'];
  if (adapter === 'Writable') return ['acquire:writer'];
  return ['acquire:writer', 'acquire:reader'];
}

function fakeSourceWithAccessors(adapter: Adapter, observed: string[]): unknown {
  const fake = (key: 'getReader' | 'getWriter'): Record<string, unknown> => {
    const source: Record<string, unknown> = {};
    Object.defineProperty(source, key, {
      get(): () => void {
        observed.push(key);
        return () => {};
      },
    });
    return source;
  };
  if (adapter === 'Readable') return fake('getReader');
  if (adapter === 'Writable') return fake('getWriter');
  return { readable: fake('getReader'), writable: fake('getWriter') };
}

function getterBagWithValues(
  keys: readonly string[],
  values: Readonly<Record<string, unknown>>,
  thrownKey: string,
  marker: unknown,
): { options: Record<string, unknown>; observed: string[] } {
  const observed: string[] = [];
  const options: Record<string, unknown> = {};
  for (const key of keys) {
    Object.defineProperty(options, key, {
      get(): unknown {
        observed.push(key);
        if (key === thrownKey) throw marker;
        return values[key];
      },
    });
  }
  return { options, observed };
}

function abortSignal(aborted: boolean): AbortSignal {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return controller.signal;
}

describe('fromWeb shared option pipeline', () => {
  it.each(adapters)('$adapter validates the source before reading options', (contract) => {
    const { options, observed } = inheritedGetterBag(contract.getterOrder);
    const error = capture(() => invoke(contract.adapter, options, {}));

    expectNodeError(error, 'ERR_INVALID_ARG_TYPE');
    expect(observed).toEqual([]);
  });

  it.each(adapters)(
    '$adapter brand-rejects a stream-shaped fake without reading accessors or options',
    (contract) => {
      const sourceAccess: string[] = [];
      const { options, observed } = inheritedGetterBag(contract.getterOrder);
      const error = capture(() =>
        invoke(contract.adapter, options, fakeSourceWithAccessors(contract.adapter, sourceAccess)),
      );

      expectNodeError(error, 'ERR_INVALID_ARG_TYPE');
      expect({ sourceAccess, optionAccess: observed }).toEqual({
        sourceAccess: [],
        optionAccess: [],
      });
    },
  );

  it('Duplex snapshots pair getters once before options and writer→reader acquisition', () => {
    const observed: string[] = [];
    const fixture = acquisitionFixture('Duplex', observed);
    const actual = fixture.source as {
      readable: ReadableStream<unknown>;
      writable: WritableStream<unknown>;
    };
    const pair = {} as { readable: ReadableStream<unknown>; writable: WritableStream<unknown> };
    Object.defineProperty(pair, 'readable', {
      get(): ReadableStream<unknown> {
        observed.push('source:readable');
        return actual.readable;
      },
    });
    Object.defineProperty(pair, 'writable', {
      get(): WritableStream<unknown> {
        observed.push('source:writable');
        return actual.writable;
      },
    });
    const { options } = inheritedGetterBag(
      duplexContract.getterOrder,
      undefined,
      undefined,
      observed,
    );

    const stream = invoke('Duplex', options, pair);

    expect(observed).toEqual([
      'source:readable',
      'source:writable',
      ...duplexContract.getterOrder,
      'acquire:writer',
      'acquire:reader',
    ]);
    expectAcquisition({ adapter: 'Duplex' }, fixture, true);
    dispose(stream);
  });

  it('Duplex lets the later writable getter throw before validating readable or options', () => {
    const marker = { source: 'writable getter' };
    const sourceObserved: string[] = [];
    const pair = {} as { readable: ReadableStream<unknown>; writable: WritableStream<unknown> };
    Object.defineProperty(pair, 'readable', {
      get(): ReadableStream<unknown> {
        sourceObserved.push('readable');
        return {} as ReadableStream<unknown>;
      },
    });
    Object.defineProperty(pair, 'writable', {
      get(): WritableStream<unknown> {
        sourceObserved.push('writable');
        throw marker;
      },
    });
    const { options, observed } = inheritedGetterBag(duplexContract.getterOrder);

    expect(capture(() => invoke('Duplex', options, pair))).toBe(marker);
    expect({ sourceObserved, optionObserved: observed }).toEqual({
      sourceObserved: ['readable', 'writable'],
      optionObserved: [],
    });
  });

  it.each(
    adapters.flatMap((contract) =>
      [null, 42].map((options) => ({ ...contract, label: String(options), options })),
    ),
  )('$adapter rejects invalid options object $label', ({ adapter, options }) => {
    const fixture = acquisitionFixture(adapter);
    expectNodeError(
      capture(() => invoke(adapter, options, fixture.source)),
      'ERR_INVALID_ARG_TYPE',
      'options',
    );
    expectAcquisition({ adapter }, fixture, false);
  });

  it.each(adapters)('$adapter reads inherited config getters once in Node order', (contract) => {
    const observed: string[] = [];
    const { options } = inheritedGetterBag(contract.getterOrder, undefined, undefined, observed);
    const fixture = acquisitionFixture(contract.adapter, observed);
    const stream = invoke(contract.adapter, options, fixture.source);

    expect(observed).toEqual([...contract.getterOrder, ...acquisitionOrder(contract.adapter)]);
    expectAcquisition(contract, fixture, true);
    dispose(stream);
  });

  it.each(
    adapters.flatMap((contract) =>
      contract.getterOrder.map((thrownKey) => ({ ...contract, thrownKey })),
    ),
  )('$adapter preserves a raw $thrownKey getter throw', (contract) => {
    const marker = { adapter: contract.adapter, key: contract.thrownKey };
    const { options, observed } = inheritedGetterBag(
      contract.getterOrder,
      contract.thrownKey,
      marker,
    );
    const fixture = acquisitionFixture(contract.adapter);
    const error = capture(() => invoke(contract.adapter, options, fixture.source));
    const prefix = contract.getterOrder.slice(
      0,
      contract.getterOrder.indexOf(contract.thrownKey) + 1,
    );

    expect(error).toBe(marker);
    expect(observed).toEqual(prefix);
    expectAcquisition(contract, fixture, false);
  });

  it.each([
    {
      adapter: 'Readable' as const,
      keys: readableContract.getterOrder,
      values: { highWaterMark: -1, encoding: 'wat' },
      thrownKey: 'objectMode',
    },
    {
      adapter: 'Writable' as const,
      keys: writableContract.getterOrder,
      values: { highWaterMark: -1, decodeStrings: 'yes' },
      thrownKey: 'objectMode',
    },
    {
      adapter: 'Duplex' as const,
      keys: duplexContract.getterOrder,
      values: { objectMode: 'yes', encoding: 'wat', highWaterMark: -1 },
      thrownKey: 'signal',
    },
  ])('$adapter snapshots later getters before validating earlier values', (contract) => {
    const marker = { adapter: contract.adapter, stage: 'late getter' };
    const { options, observed } = getterBagWithValues(
      contract.keys,
      contract.values,
      contract.thrownKey,
      marker,
    );
    const fixture = acquisitionFixture(contract.adapter);

    expect(capture(() => invoke(contract.adapter, options, fixture.source))).toBe(marker);
    expect(observed).toEqual(contract.keys.slice(0, contract.keys.indexOf(contract.thrownKey) + 1));
    expectAcquisition(contract, fixture, false);
  });

  it.each([
    {
      adapter: 'Readable' as const,
      label: 'encoding before objectMode/HWM/signal',
      options: {
        encoding: 'wat',
        objectMode: 'yes',
        highWaterMark: -1,
        signal: new AbortController().signal,
      },
      code: 'ERR_INVALID_ARG_VALUE',
      key: 'encoding',
      acquired: false,
    },
    {
      adapter: 'Readable' as const,
      label: 'objectMode before HWM/signal',
      options: {
        objectMode: 'yes',
        highWaterMark: -1,
        signal: new AbortController().signal,
      },
      code: 'ERR_INVALID_ARG_TYPE',
      key: 'objectMode',
      acquired: false,
    },
    {
      adapter: 'Readable' as const,
      label: 'HWM before signal',
      options: { highWaterMark: -1, signal: new AbortController().signal },
      code: 'ERR_INVALID_ARG_VALUE',
      key: 'highWaterMark',
      acquired: true,
    },
    {
      adapter: 'Writable' as const,
      label: 'objectMode before decodeStrings/HWM/signal',
      options: {
        objectMode: 'yes',
        decodeStrings: 'yes',
        highWaterMark: -1,
        signal: new AbortController().signal,
      },
      code: 'ERR_INVALID_ARG_TYPE',
      key: 'objectMode',
      acquired: false,
    },
    {
      adapter: 'Writable' as const,
      label: 'decodeStrings before HWM/signal',
      options: {
        decodeStrings: 'yes',
        highWaterMark: -1,
        signal: new AbortController().signal,
      },
      code: 'ERR_INVALID_ARG_TYPE',
      key: 'decodeStrings',
      acquired: false,
    },
    {
      adapter: 'Writable' as const,
      label: 'HWM before signal',
      options: { highWaterMark: -1, signal: new AbortController().signal },
      code: 'ERR_INVALID_ARG_VALUE',
      key: 'highWaterMark',
      acquired: true,
    },
    {
      adapter: 'Duplex' as const,
      label: 'objectMode before encoding/HWM/signal',
      options: {
        objectMode: 'yes',
        encoding: 'wat',
        highWaterMark: -1,
        signal: new AbortController().signal,
      },
      code: 'ERR_INVALID_ARG_TYPE',
      key: 'objectMode',
      acquired: false,
    },
    {
      adapter: 'Duplex' as const,
      label: 'encoding before HWM/signal',
      options: {
        encoding: 'wat',
        highWaterMark: -1,
        signal: new AbortController().signal,
      },
      code: 'ERR_INVALID_ARG_VALUE',
      key: 'encoding',
      acquired: false,
    },
    {
      adapter: 'Duplex' as const,
      label: 'HWM before signal',
      options: { highWaterMark: -1, signal: new AbortController().signal },
      code: 'ERR_INVALID_ARG_VALUE',
      key: 'readableHighWaterMark',
      acquired: true,
    },
  ])('$adapter validates $label', ({ adapter, options, code, key, acquired }) => {
    const fixture = acquisitionFixture(adapter);
    expectNodeError(
      capture(() => invoke(adapter, options, fixture.source)),
      code,
      key,
    );
    expectAcquisition({ adapter }, fixture, acquired);
  });

  it.each(
    adapters.flatMap((contract) =>
      [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, '1'].map((highWaterMark) => ({
        ...contract,
        highWaterMark,
      })),
    ),
  )('$adapter rejects invalid HWM $highWaterMark', (contract) => {
    const fixture = acquisitionFixture(contract.adapter);
    expectNodeError(
      capture(() =>
        invoke(contract.adapter, { highWaterMark: contract.highWaterMark }, fixture.source),
      ),
      'ERR_INVALID_ARG_VALUE',
      contract.hwmErrorKey,
    );
    expectAcquisition(contract, fixture, true);
  });

  it.each(adapters)(
    '$adapter treats null/undefined HWM as default and accepts zero',
    (contract) => {
      const withNull = invoke(contract.adapter, { highWaterMark: null });
      const withUndefined = invoke(contract.adapter, { highWaterMark: undefined });
      const withZero = invoke(contract.adapter, { highWaterMark: 0 });

      expect(hwmOf(contract.adapter, withNull)).toEqual(hwmOf(contract.adapter, withUndefined));
      expect(hwmOf(contract.adapter, withZero)).toEqual(contract.adapter === 'Duplex' ? [0, 0] : 0);

      dispose(withNull);
      dispose(withUndefined);
      dispose(withZero);
    },
  );

  it.each(adapters)(
    '$adapter rejects a non-AbortSignal signal with Node error shape',
    (contract) => {
      const fixture = acquisitionFixture(contract.adapter);
      expectNodeError(
        capture(() => invoke(contract.adapter, { signal: {} }, fixture.source)),
        'ERR_INVALID_ARG_TYPE',
        'signal',
      );
      expectAcquisition(contract, fixture, true);
    },
  );

  it.each(adapters)(
    '$adapter preserves Node raw addEventListener failure after acquisition',
    (contract) => {
      const fixture = acquisitionFixture(contract.adapter);
      const error = capture(() =>
        invoke(contract.adapter, { signal: { aborted: false } }, fixture.source),
      );

      expect(error).toBeInstanceOf(TypeError);
      expect(error).not.toHaveProperty('code');
      expect((error as Error).message).toContain('signal.addEventListener is not a function');
      expectAcquisition(contract, fixture, true);
    },
  );

  it.each(
    adapters.flatMap((contract) =>
      [null, undefined, 0, '', false].map((signal) => ({ ...contract, signal })),
    ),
  )('$adapter treats falsy signal $signal as absent', (contract) => {
    const fixture = acquisitionFixture(contract.adapter);
    const stream = invoke(contract.adapter, { signal: contract.signal }, fixture.source);
    expectAcquisition(contract, fixture, true);
    dispose(stream);
  });

  it.each(
    adapters.flatMap((contract) => [
      { ...contract, label: 'live AbortSignal', signal: abortSignal(false) },
      { ...contract, label: 'already-aborted AbortSignal', signal: abortSignal(true) },
      {
        ...contract,
        label: 'full structural signal',
        signal: {
          aborted: false,
          addEventListener(): void {},
          removeEventListener(): void {},
        },
      },
    ]),
  )('$adapter loud-throws a valid $label before reader/writer acquisition', (contract) => {
    const fixture = acquisitionFixture(contract.adapter);
    const error = capture(() =>
      invoke(contract.adapter, { signal: contract.signal }, fixture.source),
    );

    expect(error).toBeInstanceOf(NotImplementedError);
    expect(error).toMatchObject({ feature: contract.feature });
    expectAcquisition(contract, fixture, false);
  });

  it('Duplex accepts a non-boolean decodeStrings value like Node', () => {
    const stream = invoke('Duplex', { decodeStrings: 'yes' });
    dispose(stream);
  });
});
