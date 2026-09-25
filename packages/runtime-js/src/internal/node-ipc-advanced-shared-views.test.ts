import { expect, it } from 'vitest';
import { serializeNodeIpcMessage } from './node-ipc-serialization.ts';

const viewFactories: [string, (buffer: SharedArrayBuffer) => ArrayBufferView][] = [
  ['Int8Array', (buffer) => new Int8Array(buffer, 8, 16)],
  ['Uint8Array', (buffer) => new Uint8Array(buffer, 8, 16)],
  ['Uint8ClampedArray', (buffer) => new Uint8ClampedArray(buffer, 8, 16)],
  ['Int16Array', (buffer) => new Int16Array(buffer, 8, 8)],
  ['Uint16Array', (buffer) => new Uint16Array(buffer, 8, 8)],
  ['Int32Array', (buffer) => new Int32Array(buffer, 8, 4)],
  ['Uint32Array', (buffer) => new Uint32Array(buffer, 8, 4)],
  ['Float32Array', (buffer) => new Float32Array(buffer, 8, 4)],
  ['Float64Array', (buffer) => new Float64Array(buffer, 8, 2)],
  ['BigInt64Array', (buffer) => new BigInt64Array(buffer, 8, 2)],
  ['BigUint64Array', (buffer) => new BigUint64Array(buffer, 8, 2)],
  ['DataView', (buffer) => new DataView(buffer, 8, 16)],
];

// User criterion change: all binary graphs are explicit ceilings, including shared views.
it.each(viewFactories)('rejects shared %s after the one native getter walk', (_name, makeView) => {
  const buffer = new SharedArrayBuffer(32);
  const view = makeView(buffer);
  let reads = 0;
  const graph = {
    view,
    get later() {
      reads++;
      return 1;
    },
  };
  expect(() => serializeNodeIpcMessage(graph, 'advanced')).toThrow(
    'child_process.serialization.advanced.binary',
  );
  expect(reads).toBe(1);
});
