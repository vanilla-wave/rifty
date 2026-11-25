/**
 * Unit 2 Acceptance 5 + fault matrix (ADR-0573): the wasm32 space exhausted for real — the engine's
 * 4 GiB filled with blocks — and a module that does not compile. Outcomes are loud, through Node's
 * own error channel: a failed allocation — the port's or zlib's — is `onerror('insufficient memory',
 * Z_MEM_ERROR)` (never a write at address 0) and leaves the handle consistent; `crc32`, which has no
 * channel, throws RangeError; a bad module is a `ZlibEngineError` on every operation needing it.
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
/** Node's Z_MEM_ERROR through onerror: zlib's ERR_MSG(Z_MEM_ERROR). */
const MEM = ['insufficient memory', zlib.constants.Z_MEM_ERROR, 'Z_MEM_ERROR'];

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
  it('a failed port allocation is onerror Z_MEM_ERROR, never a write at address 0', () => {
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
    h.writeSync(Z_NO_FLUSH, input, 0, input.length, out, 0, out.length);
    h.writeSync(Z_NO_FLUSH, input, 0, input.length, out, 0, out.length);
    expect(errors).toEqual([MEM, MEM]);
    expect(engine.heap().slice(0, 64)).toEqual(before);
    expect([...state]).toEqual([0, 0]);
    expect(() => binding.crc32(input, 0)).toThrow(RangeError); // no error channel
    for (const b of blocks) engine.free(b);
    h.writeSync(Z_FINISH, input, 0, input.length, out, 0, out.length); // consistent: it continues
    expect(errors).toEqual([MEM, MEM]);
    h.close();
  });

  it('async: the failure reaches onerror from the scheduled work, and a pending close runs', async () => {
    const engine = new ZlibEngine(zlibWasmBytes());
    const binding = createZlibBinding(() => engine, setImmediate);
    const errors: unknown[][] = [];
    const { h } = handle(binding, errors);
    const out = Buffer.alloc(1 << 20);
    h.writeSync(Z_NO_FLUSH, Buffer.from('a'), 0, 1, Buffer.alloc(64), 0, 64);
    const blocks = exhaust(engine, 64);
    h.write(Z_NO_FLUSH, Buffer.from('b'), 0, 1, out, 0, out.length); // its out copy cannot fit
    h.close(); // pending: the write is in progress
    await new Promise((r) => setImmediate(r));
    for (const b of blocks) engine.free(b);
    expect(errors).toEqual([MEM]);
    expect(() => h.writeSync(Z_NO_FLUSH, Buffer.from('c'), 0, 1, out, 0, 64)).toThrow(
      /already finalized/,
    );
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

describe('zlib-engine after a failed port allocation', () => {
  it('a fresh input snapshot never inherits the last one’s continuation mark', () => {
    const engine = new ZlibEngine(zlibWasmBytes());
    const binding = createZlibBinding(() => engine, setImmediate);
    const errors: unknown[][] = [];
    const h = new binding.Zlib(DEFLATE);
    const state = new Uint32Array(2);
    h.onerror = (...a) => errors.push(a);
    h.init(15, 0, 8, 0, state, () => {}, undefined); // stored: the output carries the input bytes
    const P = Buffer.from(Array.from({ length: 200000 }, (_, i) => 48 + (i % 10)));
    const parts: Buffer[] = [];
    const o1 = Buffer.alloc(1000);
    h.writeSync(Z_NO_FLUSH, P, 0, P.length, o1, 0, o1.length);
    parts.push(Buffer.from(o1.subarray(0, o1.length - state[0]!)));
    const next = P.length - state[1]!; // the operation stops here: 65536
    expect(next).toBe(65536);
    // A different write: P[100000,200000) is snapshotted, its 1 MiB out copy does not fit.
    const room = engine.malloc(512 * 1024);
    const blocks = exhaust(engine, 64);
    engine.free(room);
    h.writeSync(Z_NO_FLUSH, P, 100000, 100000, Buffer.alloc(1 << 20), 0, 1 << 20);
    for (const b of blocks) engine.free(b);
    expect(errors).toEqual([MEM]);
    // The first operation continues from `next` to the same end: it must be copied afresh (a
    // snapshot that kept the old mark would be read 34464 bytes before its start).
    let [off, len] = [next, P.length - next];
    for (let i = 0; i < 1000; i++) {
      const o = Buffer.alloc(4096);
      h.writeSync(len ? Z_NO_FLUSH : Z_FINISH, P, off, len, o, 0, o.length);
      parts.push(Buffer.from(o.subarray(0, o.length - state[0]!)));
      if (!len && state[0]) break;
      off += len - state[1]!;
      len = state[1]!;
    }
    h.close();
    expect(errors).toEqual([MEM]);
    expect(zlib.inflateSync(Buffer.concat(parts)).equals(P)).toBe(true);
  });

  it('a dictionary whose wasm copy fails: zlib not yet initialised, the retry writes Node’s FDICT stream', () => {
    const engine = new ZlibEngine(zlibWasmBytes());
    const inits = { n: 0 };
    const x = engine.x;
    Object.defineProperty(engine, 'x', {
      value: {
        ...x,
        deflateInit2_: (...a: Parameters<typeof x.deflateInit2_>) => {
          inits.n++;
          return x.deflateInit2_(...a);
        },
      },
    });
    const binding = createZlibBinding(() => engine, setImmediate);
    const dictionary = Buffer.alloc(1 << 20, 'dictionary ');
    const input = Buffer.from('dictionary dictionary hello '.repeat(10));
    const h = new binding.Zlib(DEFLATE);
    const state = new Uint32Array(2);
    const errors: unknown[][] = [];
    h.onerror = (...a) => errors.push(a);
    h.init(15, -1, 8, 0, state, () => {}, dictionary);
    // ≈ 600 KB free: z_stream, copies of in/out and deflateInit2_'s ≈ 270 KB fit, 1 MiB does not.
    const room = engine.malloc(600 * 1024);
    const blocks = exhaust(engine, 64);
    engine.free(room);
    const out = Buffer.alloc(64 * 1024);
    h.writeSync(Z_FINISH, input, 0, input.length, out, 0, out.length);
    expect(errors).toEqual([MEM]);
    expect(inits.n).toBe(0); // the copy comes first: no deflateInit2_ to undo or repeat
    for (const b of blocks) engine.free(b);
    h.writeSync(Z_FINISH, input, 0, input.length, out, 0, out.length);
    h.close();
    expect(errors).toEqual([MEM]);
    expect(inits.n).toBe(1);
    expect(out.subarray(0, out.length - state[0]!).toString('hex')).toBe(
      zlib.deflateSync(input, { dictionary }).toString('hex'),
    );
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
