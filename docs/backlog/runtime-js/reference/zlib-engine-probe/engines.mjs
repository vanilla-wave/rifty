// z_stream-level adapters: one `stream(kind)` per engine, the primitives node_zlib.cc calls.
// s.init(o) / s.write(flush, input, outLen) → { err, availIn, availOut, out, msg } /
// s.setDictionary(d) / s.params(level, strategy) / s.reset() / s.end().
// A primitive the engine lacks throws Unsupported (its absence is the measurement).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export class Unsupported extends Error {}

function pakoEngine(name, z) {
  // z: { ZStream, deflateInit2, deflate, deflateEnd, deflateReset, deflateSetDictionary,
  //      inflateInit2, inflate, inflateEnd, inflateReset, inflateSetDictionary, deflateParams? }
  return {
    name,
    crc32: z.crc32, // pako 3 does not export its crc32
    stream(kind) {
      const strm = new z.ZStream();
      const isDeflate = kind === 'deflate';
      return {
        init(o) {
          return isDeflate
            ? z.deflateInit2(strm, o.level, 8, o.windowBits, o.memLevel, o.strategy)
            : z.inflateInit2(strm, o.windowBits);
        },
        write(flush, input, outLen) {
          strm.input = input;
          strm.next_in = 0;
          strm.avail_in = input.length;
          strm.output = new Uint8Array(outLen);
          strm.next_out = 0;
          strm.avail_out = outLen;
          strm.msg = '';
          const err = isDeflate ? z.deflate(strm, flush) : z.inflate(strm, flush);
          return {
            err,
            availIn: strm.avail_in,
            availOut: strm.avail_out,
            out: strm.output.subarray(0, outLen - strm.avail_out),
            msg: strm.msg || null,
          };
        },
        setDictionary(d) {
          return isDeflate ? z.deflateSetDictionary(strm, d) : z.inflateSetDictionary(strm, d);
        },
        params(level, strategy) {
          if (!z.deflateParams) throw new Unsupported('deflateParams');
          return z.deflateParams(strm, level, strategy);
        },
        reset() {
          return isDeflate ? z.deflateReset(strm) : z.inflateReset(strm);
        },
        end() {
          isDeflate ? z.deflateEnd(strm) : z.inflateEnd(strm);
        },
      };
    },
  };
}

function loadPakoLib(dir) {
  const req = createRequire(join(dir, 'package', 'index.js'));
  const d = req('./lib/zlib/deflate.js');
  const i = req('./lib/zlib/inflate.js');
  const ZStream = req('./lib/zlib/zstream.js');
  const c = req('./lib/zlib/crc32.js');
  return {
    ZStream,
    ...pick(d, 'deflate'),
    ...pick(i, 'inflate'),
    deflateParams: d.deflateParams,
    crc32: (v, b) => c(v, b, b.length, 0) >>> 0,
  };
}
function pick(m, prefix) {
  const o = {};
  for (const k of ['Init2', '', 'End', 'Reset', 'SetDictionary']) o[prefix + k] = m[prefix + k];
  return o;
}

function loadPako3(dir) {
  const p = createRequire(join(dir, 'package', 'package.json'))('./dist/pako.cjs.js');
  return {
    ZStream: p.ZStream,
    deflateInit2: p.zlibDeflateInit2,
    deflate: p.zlibDeflate,
    deflateEnd: p.zlibDeflateEnd,
    deflateReset: p.zlibDeflateReset,
    deflateSetDictionary: p.zlibDeflateSetDictionary,
    inflateInit2: p.zlibInflateInit2,
    inflate: p.zlibInflate,
    inflateEnd: p.zlibInflateEnd,
    inflateReset: p.zlibInflateReset,
    inflateSetDictionary: p.zlibInflateSetDictionary,
  };
}

/** Wasm build of Node's deps/zlib; z_stream lives in linear memory (wasm32: 14 × 4 bytes). */
export function wasmEngine(bytes, name = 'wasm-node-zlib') {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  const x = inst.exports;
  x._initialize?.();
  const SZ = 56;
  const ver = x.zlibVersion();
  const u8 = () => new Uint8Array(x.memory.buffer);
  const u32 = () => new Uint32Array(x.memory.buffer);
  const cstr = (p) => {
    if (!p) return null;
    const m = u8();
    let e = p;
    while (m[e]) e++;
    return new TextDecoder().decode(m.subarray(p, e));
  };
  return {
    name,
    exports: x,
    crc32(value, bytes) {
      const p = x.malloc(bytes.length || 1);
      new Uint8Array(x.memory.buffer).set(bytes, p);
      const r = x.crc32(value, p, bytes.length) >>> 0;
      x.free(p);
      return r;
    },
    stream(kind) {
      const isDeflate = kind === 'deflate';
      const s = x.malloc(SZ);
      u8().fill(0, s, s + SZ);
      let inPtr = 0;
      let inCap = 0;
      let outPtr = 0;
      let outCap = 0;
      const ensure = (len, which) => {
        if (which === 'in' && len > inCap) {
          if (inPtr) x.free(inPtr);
          inCap = len;
          inPtr = x.malloc(len || 1);
        }
        if (which === 'out' && len > outCap) {
          if (outPtr) x.free(outPtr);
          outCap = len;
          outPtr = x.malloc(len || 1);
        }
      };
      const f = (i) => u32()[(s >> 2) + i];
      const setF = (i, v) => {
        u32()[(s >> 2) + i] = v;
      };
      return {
        init(o) {
          return isDeflate
            ? x.deflateInit2_(s, o.level, 8, o.windowBits, o.memLevel, o.strategy, ver, SZ)
            : x.inflateInit2_(s, o.windowBits, ver, SZ);
        },
        write(flush, input, outLen) {
          ensure(input.length, 'in');
          ensure(outLen, 'out');
          u8().set(input, inPtr);
          setF(0, inPtr);
          setF(1, input.length);
          setF(3, outPtr);
          setF(4, outLen);
          setF(6, 0);
          const err = isDeflate ? x.deflate(s, flush) : x.inflate(s, flush);
          const availOut = f(4);
          return {
            err,
            availIn: f(1),
            availOut,
            out: u8().slice(outPtr, outPtr + outLen - availOut),
            msg: cstr(f(6)),
          };
        },
        setDictionary(d) {
          ensure(d.length, 'in');
          u8().set(d, inPtr);
          return isDeflate
            ? x.deflateSetDictionary(s, inPtr, d.length)
            : x.inflateSetDictionary(s, inPtr, d.length);
        },
        params(level, strategy) {
          setF(1, 0);
          setF(4, outCap);
          setF(3, outPtr);
          return x.deflateParams(s, level, strategy);
        },
        reset() {
          return isDeflate ? x.deflateReset(s) : x.inflateReset(s);
        },
        end() {
          isDeflate ? x.deflateEnd(s) : x.inflateEnd(s);
          x.free(s);
          if (inPtr) x.free(inPtr);
          if (outPtr) x.free(outPtr);
        },
      };
    },
  };
}

// zlib 1.3.1 deflateParams ported over pako's internal deflate state (not pako API: field names are
// pako internals). Measures whether pako's one missing primitive is closable outside pako.
const CONFIG = [
  [0, 0, 0, 0, 0],
  [4, 4, 8, 4, 1],
  [4, 5, 16, 8, 1],
  [4, 6, 32, 32, 1],
  [4, 4, 16, 16, 2],
  [8, 16, 32, 32, 2],
  [8, 16, 128, 128, 2],
  [8, 32, 128, 256, 2],
  [32, 128, 258, 1024, 2],
  [32, 258, 258, 4096, 2],
];
function pakoParams(z) {
  return (strm, requested, strategy) => {
    const s = strm.state;
    if (!s) return -2;
    const level = requested === -1 ? 6 : requested;
    if (level < 0 || level > 9 || strategy < 0 || strategy > 4) return -2;
    if (
      (strategy !== s.strategy || CONFIG[s.level][4] !== CONFIG[level][4]) &&
      s.last_flush !== -2
    ) {
      strm.output = new Uint8Array(64);
      strm.next_out = 0;
      strm.avail_out = 64;
      strm.avail_in = 0;
      const err = z.deflate(strm, 5);
      if (err === -2) return err;
      if (strm.avail_in || s.strstart - s.block_start + s.lookahead) return -5;
    }
    if (s.level !== level) {
      if (s.level === 0 && s.matches !== 0) {
        if (s.matches === 1) {
          const w = s.w_size;
          for (let n = 0; n < s.hash_size; n++) {
            const m = s.head[n];
            s.head[n] = m >= w ? m - w : 0;
          }
          for (let n = 0; n < w; n++) {
            const m = s.prev[n];
            s.prev[n] = m >= w ? m - w : 0;
          }
        } else s.head.fill(0);
        s.matches = 0;
      }
      s.level = level;
      [s.good_match, s.max_lazy_match, s.nice_match, s.max_chain_length] = CONFIG[level];
    }
    s.strategy = strategy;
    return 0;
  };
}

export function loadEngines(deps, build) {
  const pako3 = loadPako3(join(deps, 'pako3'));
  return {
    'pako@1.0.11': pakoEngine('pako@1.0.11', loadPakoLib(join(deps, 'pako1'))),
    'pako@2.2.0': pakoEngine('pako@2.2.0', loadPakoLib(join(deps, 'pako2'))),
    'pako@3.0.3': pakoEngine('pako@3.0.3', pako3),
    'pako@3.0.3+params': (() => {
      const z = pako3;
      return pakoEngine('pako@3.0.3+params', { ...z, deflateParams: pakoParams(z) });
    })(),
    'wasm-node-zlib': wasmEngine(readFileSync(join(build, 'zlib.wasm'))),
  };
}
