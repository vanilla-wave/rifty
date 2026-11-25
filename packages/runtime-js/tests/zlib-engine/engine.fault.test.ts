/**
 * Unit 2 Acceptance 5 + fault matrix (ADR-0573): the wasm32 space exhausted for real — the engine's
 * 4 GiB filled with blocks — and a module that does not compile. Outcomes are loud: the port's own
 * allocation is a RangeError (never a write at address 0), zlib's own is Node's `Z_MEM_ERROR`
 * through `onerror`, a bad module a `ZlibEngineError` on every operation that needs the engine.
 */
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZlibEngine, ZlibEngineError } from '../../src/zlib-engine/engine';
import { createZlibBinding } from '../../src/zlib-engine/handle';
import { zlibWasmBytes } from '../../src/zlib-engine/wasm-bytes';

const DEFLATE = 1;
const Z_NO_FLUSH = 0;
const Z_FINISH = 4;
const GIB = 2 ** 30;

/** Fill the wasm32 space: halving block sizes down to `floor` bytes; returns the blocks. */
function exhaust(engine: ZlibEngine, floor: number): number[] {
  const blocks: number[] = [];
  for (let size = 256 * 2 ** 20; size >= floor; ) {
    try {
      blocks.push(engine.malloc(size));
    } catch (e) {
      if (!(e instanceof RangeError && e.message.startsWith('zlib.wasm: malloc'))) throw e;
      size >>>= 1;
    }
  }
  return blocks;
}

function handle(binding: ReturnType<typeof createZlibBinding>, errors: unknown[][]) {
  const h = new binding.Zlib(DEFLATE);
  const state = new Uint32Array(2);
  h.onerror = (...a) => errors.push(a);
  h.init(15, -1, 8, 0, state, () => {}, undefined);
  return { h, state };
}

describe('zlib-engine under wasm memory exhaustion', () => {
  it('a failed port allocation is a loud RangeError, never a write at address 0', () => {
    const engine = new ZlibEngine(zlibWasmBytes());
    const binding = createZlibBinding(() => engine, setImmediate);
    const errors: unknown[][] = [];
    const { h, state } = handle(binding, errors);
    const out = Buffer.alloc(1024);
    h.writeSync(Z_NO_FLUSH, Buffer.from('a'), 0, 1, out, 0, out.length); // zlib state allocated
    state.fill(0);
    const blocks = exhaust(engine, 64);
    expect(engine.x.memory.buffer.byteLength).toBe(4 * GIB);
    const before = engine.heap().slice(0, 64);
    const input = Buffer.alloc(1 << 20, 'a');
    expect(() => h.writeSync(Z_NO_FLUSH, input, 0, input.length, out, 0, out.length)).toThrow(
      /^zlib\.wasm: malloc\(1048576\) failed: wasm memory exhausted$/,
    );
    expect(() => h.writeSync(Z_NO_FLUSH, input, 0, input.length, out, 0, out.length)).toThrow(
      RangeError,
    );
    expect(engine.heap().slice(0, 64)).toEqual(before);
    expect([...state]).toEqual([0, 0]);
    expect(errors).toEqual([]);
    expect(() => binding.crc32(input, 0)).toThrow(RangeError);
    for (const b of blocks) engine.free(b);
  });

  it("zlib's own allocation failing is Node's Z_MEM_ERROR through onerror; freed memory is reused", () => {
    const engine = new ZlibEngine(zlibWasmBytes());
    const binding = createZlibBinding(() => engine, setImmediate);
    const blocks = exhaust(engine, 64 * 1024);
    // Open deflate states (~300 KB each) until zlib's own allocation fails.
    const errors: unknown[][] = [];
    const out = Buffer.alloc(64);
    const opened = [];
    let failed = false;
    while (!failed && opened.length < 10_000) {
      const { h } = handle(binding, errors);
      h.writeSync(Z_NO_FLUSH, Buffer.from('x'), 0, 1, out, 0, out.length);
      failed = errors.length > 0;
      opened.push(h);
    }
    expect(errors.length).toBe(1);
    const [message, errno, code] = errors[0] ?? [];
    expect({ errno, code }).toEqual({ errno: zlib.constants.Z_MEM_ERROR, code: 'Z_MEM_ERROR' });
    // deflateInit2_: the state fits, its window does not → zlib's own ERR_MSG(Z_MEM_ERROR).
    expect(message).toBe('insufficient memory');
    for (const h of opened) h.close();
    for (const b of blocks) engine.free(b);
    const after: unknown[][] = [];
    const { h, state } = handle(binding, after);
    const big = Buffer.alloc(64 * 1024);
    h.writeSync(Z_FINISH, Buffer.from('hello'), 0, 5, big, 0, big.length);
    expect(after).toEqual([]);
    expect(zlib.inflateSync(big.subarray(0, big.length - state[0]!)).toString()).toBe('hello');
    h.close();
  });
});

describe('zlib-engine with a module that does not load', () => {
  it('the first engine operation throws ZlibEngineError, every time; no fallback', () => {
    const bad = zlibWasmBytes().slice(0, 1000);
    const binding = createZlibBinding(() => new ZlibEngine(bad), setImmediate);
    const errors: unknown[][] = [];
    const { h, state } = handle(binding, errors); // Init touches no zlib, as in Node
    const out = Buffer.alloc(64);
    const write = () => h.writeSync(Z_FINISH, Buffer.from('x'), 0, 1, out, 0, out.length);
    expect(write).toThrow(ZlibEngineError);
    expect(write).toThrow(/^zlib\.wasm failed to load: /);
    expect(() => h.params(1, 0)).toThrow(ZlibEngineError);
    expect(() => h.reset()).toThrow(ZlibEngineError);
    expect(() => binding.crc32(Buffer.from('x'), 0)).toThrow(ZlibEngineError);
    expect([...state, errors.length]).toEqual([0, 0, 0]);
    h.close();
  });
});
