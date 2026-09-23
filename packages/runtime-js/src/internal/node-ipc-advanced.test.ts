import { deserialize, serialize } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { deserializeNodeIpcMessage, serializeNodeIpcMessage } from './node-ipc-serialization.ts';

it('preserves cross-realm buffers and boxed primitive slots', () => {
  const source: unknown = runInNewContext(
    '({ buffer: new Uint8Array([2,5,9]).buffer, boolean: Object(true), number: Object(3), string: Object("hello"), bigint: Object(7n) })',
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
  const source = { value: { buffers: [new Uint8Array([1, 2])] }, buffers: ['guest'] };
  const expected: unknown = deserialize(serialize(source));
  const wire = structuredClone(serializeNodeIpcMessage(source, 'advanced'));
  expect(deserializeNodeIpcMessage(wire, 'advanced')).toEqual(expected);
});
