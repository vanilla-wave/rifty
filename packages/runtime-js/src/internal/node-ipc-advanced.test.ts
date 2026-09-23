import { deserialize, serialize } from 'node:v8';
import { expect, it } from 'vitest';
import { deserializeNodeIpcMessage, serializeNodeIpcMessage } from './node-ipc-serialization.ts';

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
