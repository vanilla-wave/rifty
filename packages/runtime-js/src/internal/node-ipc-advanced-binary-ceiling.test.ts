import { Buffer, NotImplementedError } from '@riftydev/io';
import { expect, it } from 'vitest';
import { decodeAdvancedIpc, encodeAdvancedIpc } from './node-ipc-advanced.ts';

const binaries = [
  ['Buffer', () => Buffer.from([1, 2])],
  ['ArrayBuffer', () => new ArrayBuffer(2)],
  ['SharedArrayBuffer', () => new SharedArrayBuffer(2)],
  ['typed array', () => new Uint16Array([1, 2])],
  ['DataView', () => new DataView(new ArrayBuffer(2))],
] as const;
const nests: [string, (value: unknown) => unknown][] = [
  ['root', (value) => value],
  ['record', (value) => ({ nested: [value] })],
  ['Map key', (value) => new Map([[value, 1]])],
  ['Map value', (value) => new Map([[1, value]])],
  ['Set', (value) => new Set([value])],
  ['Error cause', (value) => new Error('cause', { cause: value })],
  [
    'cycle',
    (value) => {
      const record = { self: null as unknown, value };
      record.self = record;
      return record;
    },
  ],
];
for (const [name, make] of binaries) {
  it.each(nests)(`rejects ${name} in %s with the binary ceiling`, (_name, nest) => {
    expect(() => encodeAdvancedIpc(nest(make()))).toThrow(NotImplementedError);
    expect(() => encodeAdvancedIpc(nest(make()))).toThrow(
      'child_process.serialization.advanced.binary',
    );
  });
}
it('snapshots guest getters once before inspecting binary content', () => {
  let reads = 0;
  const value = {
    get data() {
      reads++;
      return new Uint8Array([1]);
    },
  };
  expect(() => encodeAdvancedIpc(value)).toThrow('child_process.serialization.advanced.binary');
  expect(reads).toBe(1);
});
it('refuses binary receive frames and legacy Buffer metadata', () => {
  expect(() => decodeAdvancedIpc({ value: new Uint8Array([1]), buffers: [] })).toThrow(
    'child_process.serialization.advanced.binary',
  );
  expect(() => decodeAdvancedIpc({ value: {}, buffers: [new Uint8Array([1])] })).toThrow(
    'invalid advanced IPC frame',
  );
});
