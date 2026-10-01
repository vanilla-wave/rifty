import { Buffer } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { expect, it } from 'vitest';
import { createModuleLoader } from '../module-loader/loader.ts';
import { decodeAdvancedIpc, encodeAdvancedIpc } from './advanced-ipc-values.ts';

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

it('serializes Blob own properties as the native V8 ordinary record', () => {
  const message = new Blob(['bytes']);
  let gets = 0;
  Object.defineProperty(message, 'buffer', {
    enumerable: true,
    get() {
      return Buffer.from([++gets]);
    },
  });
  const result = decodeAdvancedIpc(encodeAdvancedIpc(message)) as { buffer: Uint8Array };
  expect(result instanceof Blob).toBe(false);
  expect(gets).toBe(1);
  expect(Buffer.isBuffer(result.buffer)).toBe(true);
  expect(result.buffer[0]).toBe(1);
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
