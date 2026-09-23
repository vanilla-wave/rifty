import { deserialize, serialize } from 'node:v8';
import { expect, it } from 'vitest';
import { deserializeNodeIpcMessage, serializeNodeIpcMessage } from './node-ipc-serialization.ts';

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

function bytes(view: ArrayBufferView): number[] {
  return [...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)];
}

function fixture(makeView: (buffer: SharedArrayBuffer) => ArrayBufferView) {
  const buffer = new SharedArrayBuffer(32);
  const raw = new Uint8Array(buffer);
  raw.set(Array.from({ length: 32 }, (_, index) => index + 1));
  const view = makeView(buffer);
  let reads = 0;
  const graph = {
    view,
    get later() {
      reads++;
      raw.fill(88);
      return 1;
    },
  };
  return { graph, raw, reads: () => reads };
}

it.each(viewFactories)('snapshots shared %s before a later getter', (_name, makeView) => {
  const native = fixture(makeView);
  const expected = deserialize(serialize(native.graph)) as typeof native.graph;
  const input = fixture(makeView);
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(input.graph, 'advanced')),
    'advanced',
  ) as typeof input.graph;
  expect(input.reads()).toBe(native.reads());
  expect(input.reads()).toBe(1);
  expect(bytes(actual.view)).toEqual(bytes(expected.view));
  expect(Object.prototype.toString.call(actual.view)).toBe(
    Object.prototype.toString.call(expected.view),
  );
  expect(actual.view.buffer).toBeInstanceOf(ArrayBuffer);
});

it.each(viewFactories)('isolates shared %s from post-send mutations', (_name, makeView) => {
  const native = fixture(makeView);
  const expected = deserialize(serialize(native.graph.view)) as ArrayBufferView;
  const input = fixture(makeView);
  const frame = serializeNodeIpcMessage(input.graph.view, 'advanced');
  input.raw.fill(88);
  const actual = deserializeNodeIpcMessage(structuredClone(frame), 'advanced') as ArrayBufferView;
  expect(bytes(actual)).toEqual(bytes(expected));
  input.raw.fill(99);
  expect(bytes(actual)).toEqual(bytes(expected));
  new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength).fill(77);
  expect([...input.raw]).toEqual(Array(32).fill(99));
});

it('snapshots distinct overlapping shared views at their own encounter, retaining repeated identity', () => {
  function makeGraph() {
    const buffer = new SharedArrayBuffer(8);
    const raw = new Uint8Array(buffer);
    raw.fill(1);
    const first = new Uint8Array(buffer, 2, 4);
    const second = new DataView(buffer, 2, 4);
    return {
      raw,
      graph: {
        first,
        get later() {
          raw.fill(2);
          return 0;
        },
        second,
        repeat: first,
      },
    };
  }
  const native = makeGraph();
  const expected = deserialize(serialize(native.graph)) as typeof native.graph;
  const input = makeGraph();
  const actual = deserializeNodeIpcMessage(
    structuredClone(serializeNodeIpcMessage(input.graph, 'advanced')),
    'advanced',
  ) as typeof input.graph;
  expect(bytes(actual.first)).toEqual(bytes(expected.first));
  expect(bytes(actual.second)).toEqual(bytes(expected.second));
  expect(actual.repeat).toBe(actual.first);
  expected.first[0] = 7;
  actual.first[0] = 7;
  expect(bytes(actual.second)).toEqual(bytes(expected.second));
  expect([...input.raw]).toEqual([...native.raw]);
});
