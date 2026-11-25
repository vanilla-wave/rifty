/**
 * Input is copied into wasm once per input, not once per handle call: lib/zlib.js's
 * `processChunkSync` calls the handle per 16 KiB of output with the rest of the same input, so a
 * per-call copy is quadratic (64 MiB raw inflate: 3110 ms vs Node's 10 ms before the fix). The guard
 * counts bytes, not milliseconds: under test:run's parallel load a 16 → 64 MiB timing ratio of the
 * fixed handle (10–15×, memory-bound) overlapped the quadratic one's (14–19×).
 */
import { randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZlibEngine } from '../../src/zlib-engine/engine';
import { createZlibBinding } from '../../src/zlib-engine/handle';
import { zlibWasmBytes } from '../../src/zlib-engine/wasm-bytes';
import { oneShotSync } from './harness';

/** The real engine, with the bytes JS writes into its memory counted (inputs, out windows). */
function countingBinding() {
  const engine = new ZlibEngine(zlibWasmBytes());
  const counted = { bytes: 0 };
  const heap = engine.heap.bind(engine);
  engine.heap = () => {
    const h = heap();
    const set = h.set.bind(h);
    h.set = (src: ArrayLike<number>, at?: number) => {
      counted.bytes += src.length;
      set(src, at);
    };
    return h;
  };
  return { binding: createZlibBinding(() => engine, setImmediate), counted };
}

const raw = (mb: number) => zlib.deflateRawSync(randomBytes(mb << 20), { level: 0 });

describe('zlib-engine handle copies input linearly', () => {
  it('a 16 MiB stored-block inflate copies its input into wasm once (quadratic: 8.6 GB)', () => {
    const { binding, counted } = countingBinding();
    const input = raw(16);
    const out = oneShotSync(binding, 'INFLATERAW', input);
    // input once + each 16 KiB out window once (the caller's bytes, zlib may write anywhere in it)
    expect(counted.bytes).toBeLessThanOrEqual(input.length + out.length + 2 * 16384);
  });
});
