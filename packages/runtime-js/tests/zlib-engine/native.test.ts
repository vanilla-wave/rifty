/**
 * The product handle against Node v24.16.0's own native handle (`process.binding('zlib')`, the
 * object lib/zlib.js uses) at the binding level, where a guest reaching `stream._handle` lands:
 * whole `out` buffers (zlib writes into the caller's memory, `params` included), `_writeState`,
 * `onerror` arguments. Direct cases first, then seeded sync and async sequences with `params` and
 * `reset` between writes. Only sequences Node's native CHECKs accept (they abort the process).
 */
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZlibEngine } from '../../src/zlib-engine/engine';
import { createZlibBinding } from '../../src/zlib-engine/handle';
import { zlibWasmBytes } from '../../src/zlib-engine/wasm-bytes';
import { corpus, prng } from './corpus';
import { zlibSourceCorpus } from './harness';

interface Handle {
  onerror?: (message: string, errno: number, code: string) => void;
  init(...a: unknown[]): unknown;
  write(...a: unknown[]): void;
  writeSync(...a: unknown[]): void;
  params(level: number, strategy: number): void;
  reset(): void;
  close(): void;
}
interface Binding {
  Zlib: new (mode: number) => Handle;
  crc32(data: unknown, value: number): number;
}
const native = (process as unknown as { binding(n: string): Binding }).binding('zlib');
const engine = new ZlibEngine(zlibWasmBytes());
const port = createZlibBinding(() => engine, setImmediate) as unknown as Binding;
const SIDES = [
  ['node', native],
  ['port', port],
] as const;

const C = zlib.constants;
const CORPUS = corpus(zlibSourceCorpus());
const TEXT = Buffer.from('hello hello hello world '.repeat(400));

/** Run `fn` on both sides; return each side's record. */
function both<T>(fn: (b: Binding) => T): { node: T; port: T } {
  return { node: fn(native), port: fn(port) };
}

function open(b: Binding, mode: number, level = 6, strategy = 0, windowBits = 15) {
  const h = new b.Zlib(mode);
  const state = new Uint32Array(2);
  const events: unknown[] = [];
  h.onerror = (...a) => {
    events.push(a);
  };
  h.init(windowBits, level, 8, strategy, state, () => {}, undefined);
  return { h, state, events };
}

describe('product handle = Node native handle, direct calls', () => {
  it('params() after a write flushes into the caller’s previous out, as Node', () => {
    const r = both((b) => {
      const { h, state, events } = open(b, C.DEFLATE);
      const out = Buffer.alloc(1024, 0xaa);
      h.writeSync(C.Z_NO_FLUSH, TEXT, 0, TEXT.length, out, 0, out.length);
      const afterWrite = [...state];
      h.params(1, 1);
      const out2 = Buffer.alloc(4096, 0xaa);
      h.writeSync(C.Z_FINISH, Buffer.alloc(0), 0, 0, out2, 0, out2.length);
      h.close();
      return {
        afterWrite,
        out: out.toString('hex'),
        out2: out2.toString('hex'),
        state: [...state],
        events,
      };
    });
    expect(r.port).toEqual(r.node);
  });

  it('2000 write/params cycles leave the shared engine intact and equal Node', () => {
    const run = (b: Binding) => {
      const rnd = prng(7);
      const outs: string[] = [];
      for (let i = 0; i < 2000; i++) {
        const { h, state } = open(b, C.DEFLATE);
        const d =
          i % 2
            ? Buffer.from(CORPUS.random16k.subarray(0, 3000))
            : Buffer.from('abc '.repeat(3000));
        const out = Buffer.alloc(64 + (i % 7) * 500, 0xaa);
        h.writeSync(C.Z_NO_FLUSH, d, 0, d.length, out, 0, out.length);
        h.params(1 + Math.floor(rnd() * 9), Math.floor(rnd() * 4));
        h.params(1 + Math.floor(rnd() * 9), Math.floor(rnd() * 4));
        if (i % 50 === 0) outs.push(`${out.toString('hex')}/${state.join()}`);
        h.close();
      }
      return outs;
    };
    const r = both(run);
    expect(r.port).toEqual(r.node);
  });

  it('a buffer refilled after its write completed is read anew, as Node', () => {
    const r = both((b) => {
      const { h, state } = open(b, C.DEFLATE);
      const buf = Buffer.alloc(8192, 'a');
      const outs: string[] = [];
      for (const fill of ['a', 'b', 'c']) {
        buf.fill(fill);
        const out = Buffer.alloc(16384, 0xaa);
        h.writeSync(C.Z_SYNC_FLUSH, buf, 0, buf.length, out, 0, out.length);
        outs.push(out.subarray(0, out.length - state[0]!).toString('hex'));
      }
      h.close();
      return outs;
    });
    expect(r.port).toEqual(r.node);
  });

  it('a second init() continues the same zlib stream, as Node', () => {
    const r = both((b) => {
      const { h, state } = open(b, C.DEFLATE);
      const out = Buffer.alloc(256, 0xaa);
      h.writeSync(C.Z_NO_FLUSH, Buffer.from('abc'), 0, 3, out, 0, out.length);
      h.init(15, 1, 8, 0, state, () => {}, undefined);
      h.writeSync(C.Z_FINISH, Buffer.from('def'), 0, 3, out, 0, out.length);
      h.close();
      return { out: out.toString('hex'), state: [...state] };
    });
    expect(r.port).toEqual(r.node);
  });

  it('an empty out buffer, a writeResult view at an offset, a BigInt flush', () => {
    const r = both((b) => {
      const empty = open(b, C.DEFLATE);
      empty.h.writeSync(C.Z_NO_FLUSH, Buffer.from('x'), 0, 1, Buffer.alloc(0), 0, 0);
      empty.h.close();
      const h = new b.Zlib(C.DEFLATE);
      const ab = new ArrayBuffer(16);
      h.onerror = () => {};
      h.init(15, 6, 8, 0, new Uint32Array(ab, 8, 2), () => {}, undefined);
      const out = Buffer.alloc(64);
      h.writeSync(C.Z_FINISH, Buffer.from('hello'), 0, 5, out, 0, 64);
      let bigint = '';
      try {
        h.writeSync(4n, Buffer.from('x'), 0, 1, out, 0, 64);
      } catch (e) {
        bigint = `${(e as Error).constructor.name}: ${(e as Error).message}`;
      }
      h.close();
      return { emptyOut: empty.events, writeResult: [...new Uint32Array(ab)], bigint };
    });
    expect(r.port).toEqual(r.node);
  });

  it('an onerror that throws: the throw reaches the caller, the write ends, the close runs', () => {
    const bad = Buffer.from(zlib.deflateSync(Buffer.alloc(4096, 'a')));
    bad[2]! ^= 0xff;
    const r = both((b) => {
      const h = new b.Zlib(C.INFLATE);
      const state = new Uint32Array(2);
      h.onerror = () => {
        h.close(); // pending: the write is still in progress
        throw new Error('from onerror');
      };
      h.init(0, -1, 8, 0, state, () => {}, undefined);
      const out = Buffer.alloc(1024);
      let thrown = '';
      try {
        h.writeSync(C.Z_FINISH, bad, 0, bad.length, out, 0, out.length);
      } catch (e) {
        thrown = (e as Error).message;
      }
      let after = '';
      try {
        h.reset(); // in progress → Node throws; closed → mode NONE, a no-op
        after = 'reset ok';
      } catch (e) {
        after = (e as Error).message;
      }
      return { thrown, after, state: [...state] };
    });
    expect(r.port).toEqual(r.node);
  });

  it('crc32 of strings and views, as Node', () => {
    const r = both((b) =>
      [
        '',
        'abc',
        'é\u{1f600}\ud800',
        CORPUS.text64k,
        new DataView(CORPUS.json100k.buffer, 3, 999),
      ].map((d) => b.crc32(d, 0x12345678)),
    );
    expect(r.port).toEqual(r.node);
  });
});

/**
 * The declared class (ADR-0573 §1, memory model): Node reads and writes the caller's memory live,
 * the port copies — input when the write is called, output when the work ends. Each manifestation
 * pinned with both sides' literal results (equal on macOS arm64, Linux x64/arm64 Node), so either
 * side changing shows. Not reachable through lib/zlib.js (its own buffers); reachable via _handle.
 */
describe('declared: the port copies where Node uses the caller’s memory live', () => {
  const sha16 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);

  it('in and out overlapping in one ArrayBuffer, deflate', () => {
    const r = both((b) => {
      const ab = Buffer.alloc(70000);
      for (let i = 0; i < 60000; i++) ab[i] = (i * 31) % 251;
      const { h, state, events } = open(b, C.DEFLATE);
      h.writeSync(C.Z_FINISH, ab, 0, 60000, ab, 0, 70000);
      h.close();
      return { out: `${70000 - state[0]!}:${sha16(ab.subarray(0, 70000 - state[0]!))}`, events };
    });
    expect(r).toEqual({
      node: { out: '559:7bfc48c231687329', events: [] },
      port: { out: '558:4d7399c41ffea3e7', events: [] },
    });
  });

  it('in and out overlapping in one ArrayBuffer, inflate (out = in + 50)', () => {
    const r = both((b) => {
      const plain = Buffer.from('hello world, '.repeat(2000));
      const comp = zlib.deflateSync(plain);
      const ab = Buffer.alloc(comp.length + plain.length + 100);
      comp.copy(ab, 0);
      const { h, state, events } = open(b, C.INFLATE, -1, 0, 0);
      h.writeSync(C.Z_FINISH, ab, 0, comp.length, ab, 50, ab.length - 50);
      h.close();
      return events.length ? { events } : { out: sha16(ab.subarray(50, ab.length - state[0]!)) };
    });
    expect(r).toEqual({
      node: { events: [['unexpected end of file', -5, 'Z_BUF_ERROR']] },
      port: { out: '23aa90589ba8c145' },
    });
  });

  it('params() after the last out was transferred away', () => {
    const r = both((b) => {
      const { h, state, events } = open(b, C.DEFLATE);
      const out = new Uint8Array(1024);
      h.writeSync(C.Z_NO_FLUSH, TEXT, 0, TEXT.length, out, 0, 1024);
      const moved = out.buffer.transfer();
      h.params(1, 1); // Node deflates into the memory now owned by `moved`; the port has nowhere
      h.close();
      return { moved: sha16(new Uint8Array(moved)), events, state: [...state] };
    });
    expect(r).toEqual({
      node: { moved: 'c7d95273b18f3f65', events: [], state: [1022, 0] },
      port: { moved: '897cc061e2d5ca9a', events: [], state: [1022, 0] },
    });
  });
});

/** Seeded sequences: random modes, options, flushes, buffer shapes, params/reset between writes. */
async function sequence(b: Binding, seed: number, async: boolean): Promise<unknown[]> {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const inflating = r() < 0.4;
  const fmt = pick(['DEFLATE', 'GZIP', 'DEFLATERAW'] as const);
  const mode = inflating
    ? { DEFLATE: C.INFLATE, GZIP: C.GUNZIP, DEFLATERAW: C.INFLATERAW }[fmt]
    : C[fmt];
  const src = pick([
    CORPUS.text64k,
    CORPUS.mixed300k.subarray(0, 40000),
    CORPUS.random16k,
    CORPUS.tiny,
  ]);
  const data = inflating
    ? Buffer.from(
        { DEFLATE: zlib.deflateSync, GZIP: zlib.gzipSync, DEFLATERAW: zlib.deflateRawSync }[fmt](
          src,
        ),
      )
    : Buffer.from(src);
  if (inflating && r() < 0.3) data[Math.floor(r() * data.length)] ^= 1 + Math.floor(r() * 255);
  const level = pick([-1, 0, 1, 6, 9]);
  const strategy = pick([0, 0, 1, 2, 3, 4]);
  const h = new b.Zlib(mode);
  const state = new Uint32Array(2);
  const log: unknown[] = [];
  let done: () => void = () => {};
  h.onerror = (...a) => {
    log.push(['error', ...a]);
    done();
  };
  h.init(pick([9, 12, 15]), level, pick([1, 8, 9]), strategy, state, () => done(), undefined);
  let off = 0;
  for (let step = 0; step < 12 && off <= data.length; step++) {
    const k = r();
    if (k < 0.12 && !inflating) {
      h.params(pick([0, 1, 5, 9]), pick([0, 1, 2, 3, 4]));
      log.push('params');
      continue;
    }
    if (k < 0.18) {
      h.reset();
      log.push('reset');
      continue;
    }
    const len = Math.min(data.length - off, Math.floor(r() * 9000));
    const outSize = pick([0, 1, 64, 1000, 16384]);
    const outOff = outSize > 1 ? Math.floor(r() * (outSize / 2)) : 0;
    const out = Buffer.alloc(outSize, 0xaa);
    const last = off + len >= data.length || step === 11;
    const flush = last
      ? C.Z_FINISH
      : pick([C.Z_NO_FLUSH, C.Z_PARTIAL_FLUSH, C.Z_SYNC_FLUSH, C.Z_FULL_FLUSH, C.Z_BLOCK]);
    const before = log.length;
    if (async) {
      await new Promise<void>((res) => {
        done = res;
        h.write(flush, data, off, len, out, outOff, outSize - outOff);
      });
    } else h.writeSync(flush, data, off, len, out, outOff, outSize - outOff);
    // Only what zlib reports: Node's SIMD inflate (chunk copy) leaves scratch bytes past next_out
    // inside the window and on an error; the engine's non-SIMD inflate writes none.
    const errored = log.length > before;
    const window = out.subarray(outOff);
    const outside = out.subarray(0, outOff).every((x) => x === 0xaa);
    log.push(
      errored
        ? [flush, len, '', 'error', outside]
        : [
            flush,
            len,
            window.subarray(0, window.length - state[0]!).toString('hex'),
            ...state,
            outside,
          ],
    );
    if (errored) break; // Node's stream would destroy here
    off += len - state[1]!;
    if (last) break;
  }
  h.close();
  return log;
}

const GZIP_HEAD = [0x1f, 0x8b, 8, 0, 0, 0, 0, 0]; // then XFL, then OS
/** A gzip header's OS byte, Node's build OS_CODE (19 macOS, 10 Windows, 3 elsewhere) vs the engine's 3. */
function osByte(a: Buffer, b: Buffer, k: number): boolean {
  if (b[k] !== 3 || ![3, 10, 19].includes(a[k]!)) return false;
  // As much of the header as this write produced must precede it.
  for (let i = 1; i <= 9 && k - i >= 0; i++) {
    const byte = a[k - i]!;
    if (i === 1 ? ![0, 2, 4].includes(byte) : byte !== GZIP_HEAD[9 - i]) return false;
  }
  return true;
}
/** Records equal but for gzip headers' OS byte. */
function sameRecords(n: unknown[], p: unknown[]): boolean {
  if (n.length !== p.length) return false;
  return n.every((x, i) => {
    const y = p[i];
    if (!Array.isArray(x) || !Array.isArray(y) || typeof x[2] !== 'string')
      return JSON.stringify(x) === JSON.stringify(y);
    if (
      JSON.stringify([...x.slice(0, 2), ...x.slice(3)]) !==
      JSON.stringify([...y.slice(0, 2), ...y.slice(3)])
    )
      return false;
    const a = Buffer.from(x[2], 'hex');
    const b = Buffer.from(y[2] as string, 'hex');
    return a.length === b.length && a.every((v, k) => v === b[k] || osByte(a, b, k));
  });
}

describe('product handle = Node native handle, seeded sequences', () => {
  for (const async of [false, true])
    it(
      `${async ? 'async write()' : 'writeSync'}: 1000 sequences`,
      { timeout: 120_000 },
      async () => {
        const diffs: number[] = [];
        for (let seed = 1; seed <= 1000; seed++) {
          const n = await sequence(native, seed, async);
          const p = await sequence(port, seed, async);
          if (!sameRecords(n, p)) diffs.push(seed);
        }
        expect(diffs).toEqual([]);
      },
    );
});
