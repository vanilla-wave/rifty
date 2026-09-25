import { deserialize, serialize } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { deserializeNodeIpcMessage, serializeNodeIpcMessage } from './node-ipc-serialization.ts';

it('preserves cross-realm boxed primitive slots', () => {
  const source: unknown = runInNewContext(
    '({ boolean: Object(true), number: Object(3), string: Object("hello"), bigint: Object(7n) })',
  );
  const expected = deserialize(serialize(source));
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(source, 'advanced')),
    'advanced',
  ) as Record<string, unknown>;
  for (const key of Object.keys(expected))
    expect(Object.prototype.toString.call(actual[key])).toBe(
      Object.prototype.toString.call(expected[key]),
    );
  expect(actual).toEqual(expected);
});

it('does not read an uncloneable intrinsic value to format its failure', () => {
  const value = new WeakMap();
  Object.defineProperty(value, 'toString', {
    get() {
      throw new Error('unexpected coercion');
    },
  });
  let expected = '';
  try {
    serialize(value);
  } catch (error) {
    expected = (error as Error).message;
  }
  expect(() => serializeNodeIpcMessage(value, 'advanced')).toThrow(expected);
});

it('ignores Error message/cause accessors like native serialization', () => {
  function fixture() {
    const reads: string[] = [];
    const error = new Error('original');
    error.stack = 'fixed stack';
    for (const key of ['message', 'cause'])
      Object.defineProperty(error, key, {
        get() {
          reads.push(key);
          return key === 'cause' ? { value: 7 } : 'accessor';
        },
      });
    return { error, reads };
  }
  const native = fixture();
  const expected = deserialize(serialize(native.error));
  const input = fixture();
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(input.error, 'advanced')),
    'advanced',
  );
  expect(input.reads).toEqual(native.reads);
  expect(actual).toEqual(expected);
});

it('preserves cross-realm RegExp and Error intrinsic brands', () => {
  const source: unknown = runInNewContext(
    '({ regexp: /hello/gi, error: new TypeError("broken", { cause: { value: 7 } }) })',
  );
  const expected: unknown = deserialize(serialize(source));
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(source, 'advanced')),
    'advanced',
  ) as { regexp: RegExp; error: Error };
  expect(actual.regexp).toBeInstanceOf(RegExp);
  expect(actual.error).toBeInstanceOf(TypeError);
  expect(actual).toEqual(expected);
});

it.each(['cross-realm', 'severed-prototype'])(
  'preserves %s Date/Map/Set slots and aliases',
  (mode) => {
    const source: unknown = runInNewContext(`(() => {
    const item = { value: 7 };
    const map = new Map([[item, new Set([item])]]);
    map.set('self', map);
    const date = new Date(1234);
    ${mode === 'severed-prototype' ? 'Object.setPrototypeOf(map, null); Object.setPrototypeOf(date, null);' : ''}
    return { item, map, date };
  })()`);
    const expected: unknown = deserialize(serialize(source));
    const wire = structuredClone(serializeNodeIpcMessage(source, 'advanced'));
    const actual = deserializeNodeIpcMessage(wire, 'advanced') as {
      map: Map<unknown, unknown>;
      date: Date;
      item: object;
    };
    expect(actual.map).toBeInstanceOf(Map);
    expect(actual.date).toBeInstanceOf(Date);
    expect(actual.map.get('self')).toBe(actual.map);
    expect(actual.map.has(actual.item)).toBe(true);
    expect(actual).toEqual(expected);
  },
);

it('ignores symbol accessors when snapshotting a guest object, as native advanced IPC does', () => {
  const source = {
    safe: 1,
    get [Symbol.toStringTag]() {
      throw new Error('symbol accessor must not run');
    },
  };
  const expected: unknown = deserialize(serialize(source));
  const wire = structuredClone(serializeNodeIpcMessage(source, 'advanced'));
  expect(deserializeNodeIpcMessage(wire, 'advanced')).toEqual(expected);
});

it('does not interpret guest value/buffers fields as codec metadata', () => {
  const source = { value: { buffers: [[1, 2]] }, buffers: ['guest'] };
  const expected: unknown = deserialize(serialize(source));
  const wire = structuredClone(serializeNodeIpcMessage(source, 'advanced'));
  expect(deserializeNodeIpcMessage(wire, 'advanced')).toEqual(expected);
});

const uncloneableSources = [
  'new WeakMap()',
  'new WeakSet()',
  'Promise.resolve(1)',
  'new WeakRef({})',
  'new FinalizationRegistry(() => {})',
];
it.each(uncloneableSources)('rejects intrinsic %s without reading guest properties', (source) => {
  for (const severed of [false, true]) {
    const value: object = runInNewContext(source);
    if (severed) Object.setPrototypeOf(value, null);
    let reads = 0;
    Object.defineProperty(value, 'probe', {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    Object.freeze(value);
    expect(() => serialize({ bad: value })).toThrow(/could not be cloned/);
    expect(reads).toBe(0);
    expect(() => serializeNodeIpcMessage({ bad: value }, 'advanced')).toThrow(
      /could not be cloned/,
    );
    expect(reads).toBe(0);
  }
});

it.each(['frozen', 'non-extensible', 'readonly-constructor'])(
  'preserves native-cloneable %s plain records without an opaque-brand ceiling',
  (mode) => {
    const source = { value: 7, nested: { text: 'hello' } };
    if (mode === 'frozen') Object.freeze(source);
    else if (mode === 'non-extensible') Object.preventExtensions(source);
    else
      Object.defineProperty(source, 'constructor', {
        value: 7,
        writable: false,
        configurable: false,
      });
    const expected: unknown = deserialize(serialize(source));
    const actual = deserializeNodeIpcMessage(
      structuredClone(serializeNodeIpcMessage(source, 'advanced')),
      'advanced',
    );
    expect(actual).toEqual(expected);
  },
);
