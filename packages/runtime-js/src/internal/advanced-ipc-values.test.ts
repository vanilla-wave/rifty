import { deserialize, serialize } from 'node:v8';
import { Buffer } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { expect, it } from 'vitest';
import { createModuleLoader } from '../module-loader/loader.ts';
import { decodeAdvancedIpc, encodeAdvancedIpc } from './advanced-ipc-values.ts';

it.each([
  () => {
    const value = Promise.resolve(1);
    Object.setPrototypeOf(value, null);
    return value;
  },
  () => (async () => 1)(),
  () =>
    Reflect.construct(Promise, [(resolve: (value: number) => void) => resolve(1)], class Custom {}),
  () => new WeakRef({}),
  () => new FinalizationRegistry(() => {}),
])('rejects opaque uncloneable brands before observing their properties', (factory) => {
  const value = factory();
  let gets = 0;
  Object.defineProperty(value, 'buffer', {
    enumerable: true,
    get() {
      gets++;
      return Buffer.from([1]);
    },
  });
  expect(() => serialize(value)).toThrow();
  expect(gets).toBe(0);
  expect(() => encodeAdvancedIpc(value)).toThrow();
  expect(gets).toBe(0);
});

it('rejects a live MessagePort instead of replacing it with an empty record', () => {
  const channel = new MessageChannel();
  try {
    expect(() => serialize(channel.port1)).toThrow();
    expect(() => encodeAdvancedIpc(channel.port1)).toThrow();
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});

it('keeps SAB-backed Buffer out of advanced IPC with a named ceiling', () => {
  const buffer = Buffer.from(new SharedArrayBuffer(1));
  buffer[0] = 1;
  let gets = 0;
  const message = {
    buffer,
    get after() {
      gets++;
      buffer[0] = 2;
      return 0;
    },
  };
  const native = deserialize(serialize(message)) as { buffer: Uint8Array };
  expect(native.buffer[0]).toBe(1);
  expect(gets).toBe(1);
  buffer[0] = 1;
  gets = 0;
  expect(() => encodeAdvancedIpc(message)).toThrow(/serialization.advanced.SharedArrayBuffer/);
  expect(gets).toBe(1);
});

it('rejects SharedArrayBuffer as native V8 IPC does', () => {
  const message = new SharedArrayBuffer(4);
  expect(() => serialize(message)).toThrow();
  expect(() => encodeAdvancedIpc(message)).toThrow();
});

it.each([() => new Date(0), () => new Map([['key', 7]]), () => new Set([3])])(
  'preserves core internal slots when the sender changes its prototype',
  (factory) => {
    const message = factory();
    Object.setPrototypeOf(message, null);
    const native = deserialize(serialize(message)) as object;
    const result = decodeAdvancedIpc(encodeAdvancedIpc(message)) as object;
    expect(Object.getPrototypeOf(result) === Object.getPrototypeOf(native)).toBe(true);
    expect(result).toEqual(native);
  },
);

it('reads enumerable accessors once and preserves their fresh Buffer value', () => {
  let gets = 0;
  const message = {
    get buffer() {
      return Buffer.from([++gets]);
    },
  };
  const result = decodeAdvancedIpc(encodeAdvancedIpc(message)) as { buffer: Uint8Array };
  expect(gets).toBe(1);
  expect(Buffer.isBuffer(result.buffer)).toBe(true);
  expect(result.buffer[0]).toBe(1);
});

it.each(['new Proxy({ x: 1 }, {})', 'Proxy.revocable({ x: 1 }, {}).proxy'])(
  'rejects an uncloneable guest Proxy without observing its traps: %s',
  (source) => {
    const fs = new MemoryFsSync();
    fs.loadFixture({ '/proxy.cjs': `module.exports = ${source};` });
    const value = createModuleLoader(fs).require('/proxy.cjs');
    expect(() => encodeAdvancedIpc(value)).toThrow();
  },
);

it('uses native Map contents rather than a guest iterator override', () => {
  const map = new Map([['buffer', Buffer.from([3])]]);
  map[Symbol.iterator] = () => {
    throw new Error('guest iterator');
  };
  const result = decodeAdvancedIpc(encodeAdvancedIpc(map)) as Map<string, unknown>;
  expect(Buffer.isBuffer(result.get('buffer'))).toBe(true);
});

it('skips properties deleted by an earlier getter', () => {
  const message: { readonly a: number; b?: number } = {
    get a() {
      Reflect.deleteProperty(this, 'b');
      return 1;
    },
    b: 2,
  };
  const result = decodeAdvancedIpc(encodeAdvancedIpc(message));
  expect(result).toEqual({ a: 1 });
  expect(Object.keys(result as object)).toEqual(['a']);
});

it('rejects browser-only Blob clone semantics with a named ceiling', () => {
  const message = new Blob(['bytes']);
  expect(Object.getPrototypeOf(deserialize(serialize(message)))).toBe(Object.prototype);
  expect(() => encodeAdvancedIpc(message)).toThrow(/serialization.advanced.WebObject/);
});

it('preserves an existing Buffer hidden behind a getter and repeated aliases', () => {
  const buffer = Buffer.from([7]);
  let gets = 0;
  const message = {
    get hidden() {
      gets++;
      return buffer;
    },
    again: buffer,
  };
  const result = decodeAdvancedIpc(encodeAdvancedIpc(message)) as typeof message;
  expect(gets).toBe(1);
  expect(Buffer.isBuffer(result.hidden)).toBe(true);
  expect(result.hidden).toBe(result.again);
});

it.each([
  (value: Uint8Array) => Object.setPrototypeOf(value, Buffer.prototype),
  (value: Uint8Array) => Reflect.setPrototypeOf(value, Buffer.prototype),
  (value: Uint8Array) =>
    Object.getOwnPropertyDescriptor(Object.prototype, '__proto__')!.set!.call(
      value,
      Buffer.prototype,
    ),
])('preserves a byte view adopted into Buffer.prototype', (adopt) => {
  const value = new Uint8Array([4]);
  adopt(value);
  const result = decodeAdvancedIpc(encodeAdvancedIpc(value)) as Uint8Array;
  expect(Buffer.isBuffer(result)).toBe(true);
  expect(result[0]).toBe(4);
});

it('tracks a custom typed-array newTarget with Buffer.prototype', () => {
  const value = Reflect.construct(Uint8Array, [[5]], Buffer) as Uint8Array;
  const result = decodeAdvancedIpc(encodeAdvancedIpc(value)) as Uint8Array;
  expect(Buffer.isBuffer(result)).toBe(true);
  expect(result[0]).toBe(5);
});

it('filters detached and unbranded views without reading unrelated guest accessors', () => {
  const unrelated = Buffer.from([8]);
  structuredClone(unrelated.buffer, { transfer: [unrelated.buffer as ArrayBuffer] });
  const view = new Uint8Array([9]);
  let gets = 0;
  Object.defineProperty(view, Symbol.for('@riftydev/io.Buffer'), {
    get() {
      gets++;
      return true;
    },
  });
  const result = decodeAdvancedIpc(encodeAdvancedIpc({ value: Buffer.from([3]) })) as {
    value: Uint8Array;
  };
  expect(gets).toBe(0);
  expect(Buffer.isBuffer(result.value)).toBe(true);
  expect(result.value[0]).toBe(3);
});

it('preserves Buffer/map aliases and a circular ordinary graph', () => {
  const buffer = Buffer.from([6]);
  const map = new Map<unknown, unknown>();
  const message = { buffer, map };
  map.set(buffer, message);
  const result = decodeAdvancedIpc(encodeAdvancedIpc(message)) as typeof message;
  expect(Buffer.isBuffer(result.buffer)).toBe(true);
  expect(result.map.get(result.buffer)).toBe(result);
});

it('retains native Proxy constructor and revocable reflection/behavior', () => {
  const fs = new MemoryFsSync();
  fs.loadFixture({
    '/reflection.cjs': `
    const keys = Object.getOwnPropertyNames(Proxy);
    const revocable = Proxy.revocable({ x: 1 }, {});
    const before = revocable.proxy.x; revocable.revoke();
    let revoked = false; try { revocable.proxy.x; } catch(e) { revoked = e instanceof TypeError; }
    module.exports = [keys, Proxy.name, Proxy.length, typeof Proxy.prototype,
      Object.getOwnPropertyDescriptor(Proxy, 'revocable').value === Proxy.revocable,
      Proxy.revocable.name, Proxy.revocable.length, before, revoked,
      Function.prototype.toString.call(Proxy).includes('[native code]')];
  `,
  });
  expect(createModuleLoader(fs).require('/reflection.cjs')).toEqual([
    ['length', 'name', 'revocable'],
    'Proxy',
    2,
    'undefined',
    true,
    'revocable',
    2,
    1,
    true,
    true,
  ]);
});
