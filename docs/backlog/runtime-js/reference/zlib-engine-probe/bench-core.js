// Realm-neutral bench (classic script: Node, isolated-vm, browser worker). Needs `globalThis.pako`
// (pako UMD) and/or `globalThis.ZLIB_WASM` (bytes of zlib.wasm). Defines globalThis.zbench.
(() => {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const OUT = 16384; // Node's Z_DEFAULT_CHUNK
  function prng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const WORDS =
    'the quick brown fox jumps over lazy dog lorem ipsum dolor sit amet zlib deflate inflate stream window buffer node rifty sandbox chunk flush'
      .split(' ')
      .map((w) => [...w].map((c) => c.charCodeAt(0)));
  /** ~70% words, ~30% random runs, ~3.3x at level 6. */
  function data(n) {
    const r = prng(7);
    const b = new Uint8Array(n);
    let i = 0;
    while (i < n) {
      if (r() < 0.03) {
        const e = Math.min(n, i + 64);
        while (i < e) b[i++] = (r() * 256) | 0;
        continue;
      }
      const w = WORDS[(r() * WORDS.length) | 0];
      for (let k = 0; k < w.length && i < n; k++) b[i++] = w[k];
      if (i < n) b[i++] = 32;
    }
    return b;
  }
  function concat(parts, total) {
    const o = new Uint8Array(total);
    let p = 0;
    for (const x of parts) {
      o.set(x, p);
      p += x.length;
    }
    return o;
  }
  const engines = {};
  engines.pako = () => {
    const p = globalThis.pako;
    return {
      run(kind, input, opts) {
        const strm = new p.ZStream();
        const isD = kind === 'deflate';
        isD ? p.zlibDeflateInit2(strm, opts.level ?? 6, 8, 15, 8, 0) : p.zlibInflateInit2(strm, 15);
        strm.input = input;
        strm.next_in = 0;
        strm.avail_in = input.length;
        const parts = [];
        let total = 0;
        for (;;) {
          strm.output = new Uint8Array(OUT);
          strm.next_out = 0;
          strm.avail_out = OUT;
          const err = isD ? p.zlibDeflate(strm, 4) : p.zlibInflate(strm, 4);
          const have = OUT - strm.avail_out;
          if (have) {
            parts.push(strm.output.subarray(0, have));
            total += have;
          }
          if (err === 1) break;
          if (err < 0 && err !== -5) throw new Error(`pako ${err} ${strm.msg}`);
          if (strm.avail_out !== 0) throw new Error('unexpected end of file');
        }
        isD ? p.zlibDeflateEnd(strm) : p.zlibInflateEnd(strm);
        return concat(parts, total);
      },
    };
  };
  let wasmModule = null;
  engines.wasm = () => {
    const t0 = now();
    wasmModule ??= new WebAssembly.Module(globalThis.ZLIB_WASM);
    const t1 = now();
    const x = new WebAssembly.Instance(wasmModule, {}).exports;
    x._initialize();
    const t2 = now();
    const ver = x.zlibVersion();
    return {
      init: { compileMs: t1 - t0, instantiateMs: t2 - t1 },
      exports: x,
      run(kind, input, opts) {
        const isD = kind === 'deflate';
        const s = x.malloc(56);
        new Uint8Array(x.memory.buffer).fill(0, s, s + 56);
        isD
          ? x.deflateInit2_(s, opts.level ?? 6, 8, 15, 8, 0, ver, 56)
          : x.inflateInit2_(s, 15, ver, 56);
        const IN = 1 << 20; // feed 1 MiB slices, as Node feeds stream writes
        const inPtr = x.malloc(IN);
        const outPtr = x.malloc(OUT);
        const parts = [];
        let total = 0;
        let off = 0;
        let u32 = new Uint32Array(x.memory.buffer);
        let done = false;
        while (!done) {
          const n = Math.min(IN, input.length - off);
          new Uint8Array(x.memory.buffer).set(input.subarray(off, off + n), inPtr);
          off += n;
          const flush = off === input.length ? 4 : 0;
          u32 = new Uint32Array(x.memory.buffer);
          u32[s >> 2] = inPtr;
          u32[(s >> 2) + 1] = n;
          for (;;) {
            u32 = new Uint32Array(x.memory.buffer);
            u32[(s >> 2) + 3] = outPtr;
            u32[(s >> 2) + 4] = OUT;
            const err = isD ? x.deflate(s, flush) : x.inflate(s, flush);
            u32 = new Uint32Array(x.memory.buffer);
            const have = OUT - u32[(s >> 2) + 4];
            if (have) {
              parts.push(new Uint8Array(x.memory.buffer).slice(outPtr, outPtr + have));
              total += have;
            }
            if (err === 1) {
              done = true;
              break;
            }
            if (err < 0 && err !== -5) throw new Error(`zlib ${err}`);
            if (u32[(s >> 2) + 4] !== 0) break; // input slice consumed
          }
          if (!done && off === input.length) throw new Error('unexpected end of file');
        }
        isD ? x.deflateEnd(s) : x.inflateEnd(s);
        x.free(inPtr);
        x.free(outPtr);
        x.free(s);
        return concat(parts, total);
      },
    };
  };
  function time(fn, reps) {
    let best = Number.POSITIVE_INFINITY;
    let out;
    for (let i = 0; i < reps; i++) {
      const t = now();
      out = fn();
      best = Math.min(best, now() - t);
    }
    return { ms: best, out };
  }
  globalThis.zbench = {
    data,
    /** First use in this realm: engine setup + one 1 KiB deflate+inflate (the warm-call cost). */
    firstUse(name) {
      const t = now();
      const e = engines[name]();
      const d = data(1024);
      const c = e.run('deflate', d, {});
      e.run('inflate', c, {});
      return { ms: now() - t, init: e.init ?? null };
    },
    run(name, mib, reps) {
      const e = engines[name]();
      const d = data(mib * 1048576);
      const c = time(() => e.run('deflate', d, { level: 6 }), reps);
      const u = time(() => e.run('inflate', c.out, {}), reps);
      let ok = u.out.length === d.length;
      for (let i = 0; ok && i < d.length; i += 4093) ok = u.out[i] === d[i];
      const mem = e.exports ? e.exports.memory.buffer.byteLength : null;
      return {
        engine: name,
        mib,
        deflateMs: +c.ms.toFixed(1),
        inflateMs: +u.ms.toFixed(1),
        ratio: +(d.length / c.out.length).toFixed(2),
        roundTrip: ok,
        wasmMemoryBytes: mem,
        compressed: c.out,
      };
    },
  };
})();
