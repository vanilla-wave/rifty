// Unit 2 Acceptance 2, differential half (ADR-0573): Node v24.16.0's own lib/zlib.js — the pinned
// fixture, verbatim (sha256 in src/zlib-engine/generated/sources.json; = the binary's builtin) —
// over the product handle with Node's `stream.Transform` (column port/N), against real `node:zlib`.
// Scenarios are the probe's zlib-diff.mjs, unchanged (its column port/R — rifty's Transform — is
// unit 3's entry criterion, not this unit's). Prints { builtin: fixture = this Node's builtin source, results: {
// scenario: { group, node, 'port/N' } } }. usage: node --expose-internals --import tsx lib-zlib-diff.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import nodeStream from 'node:stream';
import vm from 'node:vm';
import realZlib from 'node:zlib';
import { ZlibEngine } from '../../src/zlib-engine/engine.ts';
import { createZlibBinding } from '../../src/zlib-engine/handle.ts';
import { zlibWasmBytes } from '../../src/zlib-engine/wasm-bytes.ts';

const require = createRequire(import.meta.url);
const SRC = readFileSync(
  new URL('../fixtures/zlib-engine/node/lib/zlib.js', import.meta.url),
  'utf8',
);
const { internalBinding, primordials } = require('internal/test/binding');
const product = createZlibBinding(() => new ZlibEngine(zlibWasmBytes()), setImmediate);

/** lib/zlib.js as Node compiles it: (exports, require, module, process, internalBinding, primordials). */
function loadLibZlib(stream) {
  const zb = internalBinding('zlib');
  const binding = Object.assign(Object.create(zb), { Zlib: product.Zlib });
  const fn = vm.compileFunction(
    SRC,
    ['exports', 'require', 'module', 'process', 'internalBinding', 'primordials'],
    { filename: 'node:zlib (v24.16.0 lib/zlib.js)' },
  );
  const module = { exports: {} };
  fn(
    module.exports,
    (id) => (id === 'stream' ? stream : require(id)),
    module,
    process,
    (n) => (n === 'zlib' ? binding : internalBinding(n)),
    primordials,
  );
  return module.exports;
}

const COLS = {
  node: { z: realZlib, S: nodeStream },
  'port/N': {
    z: loadLibZlib({ Transform: nodeStream.Transform, finished: nodeStream.finished }),
    S: nodeStream,
  },
};
const C = realZlib.constants;
const T = Buffer.from('the quick brown fox jumps over the lazy dog '.repeat(3000));
const Z = realZlib.deflateSync(T);
const BAD = Buffer.from(Z);
BAD[40] ^= 0x55;
const DICT = T.subarray(0, 2048);
const ZD = realZlib.deflateSync(T, { dictionary: DICT });
const tick = () => new Promise((r) => setTimeout(r, 20));
const sha = (b) => `${b.length}:${createHash('sha256').update(b).digest('hex').slice(0, 16)}`;
/** Full value: bytes by length + hash, errors by class, code, errno and the whole message. */
const val = (v) => {
  if (v instanceof Error)
    return { error: v.name, code: v.code, errno: v.errno, message: v.message };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    // A gzip header's OS byte is Node's build OS_CODE (19 on this macOS Node), 3 from the engine.
    const b = Buffer.from(v);
    if (b.length > 9 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 8) b[9] = 3;
    return sha(b);
  }
  return v;
};
const attempt = async (f) => {
  try {
    return { ok: val(await f()) };
  } catch (e) {
    return { throw: val(e) };
  }
};
const snap = (e) => ({
  destroyed: e.destroyed,
  errored: e.errored ? val(e.errored) : (e.errored ?? null),
  closed: e.closed,
  _closed: e._closed,
  handle: e._handle === null ? null : typeof e._handle,
  readableFlowing: e.readableFlowing,
  readableEnded: e.readableEnded,
  writableEnded: e.writableEnded,
  writableFinished: e.writableFinished,
  bytesWritten: e.bytesWritten,
});
function watch(e, t) {
  const d = e.destroy;
  e.destroy = function (...a) {
    t.push(`destroy(${a[0] ? 'err' : ''})`);
    return d.apply(this, a);
  };
  const own = e._destroy;
  e._destroy = function (...a) {
    t.push('_destroy');
    return own.apply(this, a);
  };
  for (const ev of ['error', 'close', 'end', 'finish']) e.on(ev, () => t.push(`event:${ev}`));
}
const cb = (fn) =>
  new Promise((res) =>
    fn((err, r) =>
      res(
        err
          ? { err: val(err) }
          : {
              ok: r?.engine ? { buffer: val(r.buffer), engine: r.engine.constructor.name } : val(r),
            },
      ),
    ),
  );
/** Drive a stream: steps run in order; collects output bytes, events, errors and the final state. */
async function drive(s, steps) {
  const t = [];
  watch(s, t);
  const out = [];
  s.on('data', (d) => out.push(d));
  s.on('error', (e) => t.push(`error ${e.code ?? e.name}: ${e.message}`));
  const ended = new Promise((r) => {
    s.on('end', r);
    s.on('close', r);
  });
  const results = [];
  for (const step of steps) results.push(await attempt(() => step(s)));
  await Promise.race([ended, tick().then(tick).then(tick)]);
  await tick();
  return { out: sha(Buffer.concat(out)), results, trace: t, state: snap(s) };
}
const w = (chunk) => (s) => new Promise((r) => s.write(chunk, () => r('written')));
const end = (chunk) => (s) => {
  s.end(chunk);
  return 'end';
};
const flushK = (kind) => (s) =>
  new Promise((r) =>
    kind === undefined ? s.flush(() => r('flushed')) : s.flush(kind, () => r('flushed')),
  );
const collect = (s) =>
  new Promise((res, rej) => {
    const o = [];
    s.on('data', (d) => o.push(d));
    s.on('end', () => res(Buffer.concat(o)));
    s.on('error', rej);
  });

const STATE = {
  'surface: members and class shape': async ({ z }) => {
    const d = new z.Deflate();
    const r = {
      asyncDispose: typeof d[Symbol.asyncDispose],
      members: ['close', 'flush', 'params', 'reset', '_processChunk', '_transform', '_flush']
        .map((k) => `${k}:${typeof d[k]}`)
        .join(' '),
      classes: ['Deflate', 'Inflate', 'Gzip', 'Gunzip', 'DeflateRaw', 'InflateRaw', 'Unzip']
        .map((k) => `${z[k].name}/${z[k].length}`)
        .join(' '),
    };
    d.close();
    return r;
  },
  'ctor {highWaterMark: -1}': ({ z }) => attempt(() => z.deflateSync('abc', { highWaterMark: -1 })),
  'ctor {signal: 1}': ({ z }) => attempt(() => z.deflateSync('abc', { signal: 1 })),
  'ctor {chunkSize: 10}': ({ z }) => attempt(() => z.deflateSync('abc', { chunkSize: 10 })),
  'ctor {windowBits: 99}': ({ z }) => attempt(() => z.deflateSync('abc', { windowBits: 99 })),
  'ctor {level: 99}': ({ z }) => attempt(() => z.deflateSync('abc', { level: 99 })),
  'ctor {dictionary: "x"}': ({ z }) => attempt(() => z.deflateSync('abc', { dictionary: 'x' })),
  'ctor {objectMode, encoding}': ({ z }) =>
    attempt(() => z.deflateSync('abc', { objectMode: true, encoding: 'hex' })),
  'guard: call without new': ({ z }) => attempt(() => typeof z.Deflate().write),
  'guard: Inflate.call(this) + _processChunk (pngjs)': ({ z }) =>
    attempt(() => {
      function I(o) {
        z.Inflate.call(this, o);
      }
      Object.setPrototypeOf(I.prototype, z.Inflate.prototype);
      return new I()._processChunk(Z, C.Z_FINISH);
    }),
  'guard: class extends DeflateRaw (crc32-stream)': async ({ z }) => {
    class D extends z.DeflateRaw {}
    return attempt(() => collect(new D().end(T)));
  },
  'sync: deflateSync level 1 / 9': ({ z }) => ({
    l1: val(z.deflateSync(T, { level: 1 })),
    l9: val(z.deflateSync(T, { level: 9 })),
  }),
  'sync: success, then state': async ({ z }) => {
    const e = new z.Deflate();
    const r = await attempt(() => e._processChunk(T, C.Z_FINISH));
    const s1 = snap(e);
    await tick();
    return { r, sync: s1, later: snap(e) };
  },
  'sync: error, state, reset(), again': async ({ z }) => {
    const e = new z.Inflate();
    const t = [];
    watch(e, t);
    e.on('error', () => {});
    const r = await attempt(() => e._processChunk(BAD, C.Z_FINISH));
    const s1 = snap(e);
    await tick();
    const s2 = snap(e);
    const reset = await attempt(() => e.reset());
    const again = await attempt(() => e._processChunk(Z, C.Z_FINISH));
    return { r, sync: s1, later: s2, reset, again, trace: t };
  },
  'sync: maxOutputLength 1000': ({ z }) =>
    attempt(() => z.inflateSync(Z, { maxOutputLength: 1000 })),
  'sync: info engine state': ({ z }) => {
    const r = z.gzipSync(T, { info: true });
    return { buffer: val(r.buffer), isGzip: r.engine instanceof z.Gzip, engine: snap(r.engine) };
  },
  'sync: close() then _processChunk next tick': async ({ z }) => {
    const e = new z.Deflate();
    e.close();
    await tick();
    return { r: await attempt(() => e._processChunk(T, C.Z_FINISH)), state: snap(e) };
  },
  'close(cb) before writing': async ({ z }) => {
    const e = new z.Deflate();
    const r = await new Promise((res) => e.close((err) => res(err ? val(err) : 'cb()')));
    return { r, state: snap(e) };
  },
  'close(cb) after a write': async ({ z }) => {
    const e = new z.Deflate();
    e.on('data', () => {});
    await new Promise((r) => e.write(T, r));
    const r = await new Promise((res) => e.close((err) => res(err ? val(err) : 'cb()')));
    return { r, state: snap(e) };
  },
  'close(cb) after an error': async ({ z }) => {
    const e = new z.Inflate();
    e.on('error', () => {});
    e.end(BAD);
    await tick();
    const r = await new Promise((res) => e.close((err) => res(err ? val(err) : 'cb()')));
    return { r, state: snap(e) };
  },
  'callback: deflate success, info': ({ z }) => cb((k) => z.deflate(T, { info: true }, k)),
  'callback: inflate error': ({ z }) => cb((k) => z.inflate(BAD, k)),
  'callback: maxOutputLength 1000': ({ z }) =>
    cb((k) => z.inflate(Z, { maxOutputLength: 1000 }, k)),
  'callback: unzip of gzip and zlib': async ({ z }) => ({
    g: await cb((k) => z.unzip(realZlib.gzipSync(T), k)),
    z: await cb((k) => z.unzip(Z, k)),
  }),
  'stream: end(T), trace': ({ z }) => drive(new z.Deflate(), [end(T)]),
  'stream: write, params(1, 0), end': ({ z }) =>
    drive(z.createDeflate(), [
      w(T.subarray(0, 50000)),
      (s) => new Promise((r) => s.params(1, 0, () => r('params'))),
      end(T.subarray(50000)),
    ]),
  'stream: write, flush() default, end': ({ z }) =>
    drive(z.createDeflate(), [w(T.subarray(0, 50000)), flushK(), end(T.subarray(50000))]),
  'stream: flush(Z_SYNC_FLUSH)': ({ z }) =>
    drive(z.createDeflate(), [
      w(T.subarray(0, 50000)),
      flushK(C.Z_SYNC_FLUSH),
      end(T.subarray(50000)),
    ]),
  'stream: flush(Z_FULL_FLUSH)': ({ z }) =>
    drive(z.createDeflate(), [
      w(T.subarray(0, 50000)),
      flushK(C.Z_FULL_FLUSH),
      end(T.subarray(50000)),
    ]),
  'stream: flush(Z_BLOCK)': ({ z }) =>
    drive(z.createDeflate(), [w(T.subarray(0, 50000)), flushK(C.Z_BLOCK), end(T.subarray(50000))]),
  'stream: flush(Z_PARTIAL_FLUSH)': ({ z }) =>
    drive(z.createDeflate(), [
      w(T.subarray(0, 50000)),
      flushK(C.Z_PARTIAL_FLUSH),
      end(T.subarray(50000)),
    ]),
  'stream: write, reset(), write, end': ({ z }) =>
    drive(z.createDeflate(), [w(T.subarray(0, 50000)), (s) => s.reset(), end(T.subarray(50000))]),
  'stream: reset() while a write is pending': ({ z }) =>
    drive(z.createDeflate(), [
      (s) => {
        s.write(T);
        return s.reset();
      },
      end(),
    ]),
  'stream: flush after end': ({ z }) => drive(z.createDeflate(), [end(T), flushK()]),
  'stream: dictionary round trip': async ({ z }) => {
    const c = await collect(z.createDeflate({ dictionary: DICT }).end(T));
    return { c: val(c), d: val(await collect(z.createInflate({ dictionary: DICT }).end(c))) };
  },
  'stream: missing dictionary': ({ z }) => drive(z.createInflate(), [end(ZD)]),
  'stream: finishFlush Z_SYNC_FLUSH on truncated input': ({ z }) =>
    drive(z.createInflate({ finishFlush: C.Z_SYNC_FLUSH }), [end(Z.subarray(0, Z.length - 20))]),
  'stream: rejectGarbageAfterEnd': ({ z }) =>
    drive(z.createInflate({ rejectGarbageAfterEnd: true }), [
      end(Buffer.concat([Z, Buffer.from('JUNK!')])),
    ]),
  'stream: bytesWritten with a trailing tail': ({ z }) =>
    drive(z.createInflate(), [end(Buffer.concat([Z, Buffer.from('JUNK!')]))]),
  'stream: bytesWritten after reset': ({ z }) =>
    drive(z.createDeflate(), [
      w(T.subarray(0, 1000)),
      (s) => s.reset(),
      end(T.subarray(1000, 2000)),
    ]),
  'stream: destroy mid-write': ({ z }) =>
    drive(z.createGzip(), [
      (s) => {
        s.write(T);
        s.destroy();
        return 'destroyed';
      },
    ]),
  'guard: pipe gzip → gunzip': ({ z, S }) =>
    attempt(() => collect(S.Readable.from([T]).pipe(z.createGzip()).pipe(z.createGunzip()))),
  'guard: async iteration': async ({ z }) =>
    attempt(async () => {
      const g = z.createGunzip();
      g.end(realZlib.gzipSync(T));
      const o = [];
      for await (const c of g) o.push(c);
      return Buffer.concat(o);
    }),
  'guard: pipeline': ({ z, S }) =>
    attempt(
      () =>
        new Promise((res, rej) => {
          const o = [];
          S.pipeline(
            S.Readable.from([T]),
            z.createDeflate(),
            z.createInflate(),
            new S.Writable({
              write: (c, _e, k) => {
                o.push(c);
                k();
              },
            }),
            (e) => (e ? rej(e) : res(Buffer.concat(o))),
          );
        }),
    ),
  'guard: finished(gzip) after end': ({ z, S }) =>
    attempt(
      () =>
        new Promise((res) => {
          const g = z.createGzip();
          g.resume();
          S.finished(g, (e) => res(e ? val(e) : 'finished'));
          g.end(T);
        }),
    ),
};
/**
 * Declared limit (ADR-0573, unit 2 Decisions): the port snapshots a write's input when the write
 * starts and does not re-read it until the write ends; Node reads the caller's memory live. Both
 * sides pinned, so convergence shows. lib/zlib.js's async path pushes output ('data') before its
 * continuation write — the window where a listener can change the input.
 */
const PLAIN = Buffer.concat([
  Buffer.from('abcdefghij'.repeat(20000)),
  Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 7919) % 256)),
]);
const DECLARED = {
  'declared: inflate input changed in the first data event': ({ z }) =>
    new Promise((res) => {
      const input = Buffer.from(realZlib.deflateSync(PLAIN));
      const inf = z.createInflate();
      const chunks = [];
      let first = true;
      inf.on('data', (d) => {
        chunks.push(d);
        if (first) {
          first = false;
          input.fill(0x55, 20);
        }
      });
      inf.on('error', (e) => res({ error: val(e) }));
      inf.on('end', () => {
        const o = Buffer.concat(chunks);
        res({ end: val(o), plain: o.equals(PLAIN) });
      });
      inf.end(input);
    }),
  'declared: level-0 deflate input changed in the first data event': ({ z }) =>
    new Promise((res) => {
      const input = Buffer.alloc(200000, 0x61);
      const d = z.createDeflate({ level: 0 });
      const chunks = [];
      let first = true;
      d.on('data', (c) => {
        chunks.push(c);
        if (first) {
          first = false;
          input.fill(0x41);
        }
      });
      d.on('end', () => {
        const o = realZlib.inflateSync(Buffer.concat(chunks));
        res({ bytes: o.length, A: o.filter((b) => b === 0x41).length });
      });
      d.end(input);
    }),
};
/** The memory model's guarantee: the input is taken when write() is called (it may move after). */
const settle = (s, fn) =>
  new Promise((res) => {
    const chunks = [];
    s.on('data', (c) => chunks.push(Buffer.from(c)));
    s.on('error', (e) => res({ error: val(e) }));
    s.on('end', () => res(fn(Buffer.concat(chunks))));
  });
const MEMORY = {
  'memory: deflate input transferred after write()': ({ z }) => {
    const d = z.createDeflate();
    const r = settle(d, (o) => ({ out: val(o), inflated: realZlib.inflateSync(o).length }));
    const buf = Buffer.alloc(100000, 0x61);
    d.write(buf);
    keep.push(buf.buffer.transfer());
    d.end();
    return r;
  },
  // (An inflate whose input is transferred before its continuation write aborts Node itself:
  // CHECK(Buffer::IsWithinBounds) — not a scenario.)
  'memory: deflate input moved by structuredClone transfer after write()': ({ z }) => {
    const d = z.createDeflate();
    const r = settle(d, (o) => ({ out: val(o), inflated: realZlib.inflateSync(o).length }));
    const buf = Buffer.alloc(100000, 0x62);
    d.write(buf);
    keep.push(structuredClone(buf.buffer, { transfer: [buf.buffer] }));
    d.end();
    return r;
  },
};
const keep = [];
const LOAD = {
  // readableLength before reading is timing-dependent in Node itself: not observed.
  'load: 5 MB deflate with a paused consumer': async ({ z }) => {
    const d = z.createDeflate({ highWaterMark: 1024 });
    const big = Buffer.concat(Array.from({ length: 40 }, () => T));
    let falses = 0;
    let drains = 0;
    d.on('drain', () => drains++);
    const o = [];
    for (let i = 0; i < big.length; i += 65536) if (!d.write(big.subarray(i, i + 65536))) falses++;
    d.end();
    await tick();
    d.on('data', (c) => o.push(c));
    await new Promise((r) => d.on('end', r));
    return { falses, drains, out: val(Buffer.concat(o)) };
  },
};

const results = {};
for (const [group, set] of [
  ['state', STATE],
  ['load', LOAD],
  ['declared', DECLARED],
  ['memory', MEMORY],
])
  for (const [name, run] of Object.entries(set)) {
    results[name] = { group };
    for (const [col, lib] of Object.entries(COLS)) {
      try {
        results[name][col] = await Promise.race([
          run(lib),
          new Promise((r) => setTimeout(() => r({ timeout: true }), 5000)),
        ]);
      } catch (e) {
        results[name][col] = { scenarioThrew: val(e) };
      }
    }
  }
const builtin = SRC === internalBinding('builtins').natives.zlib;
process.stdout.write(`${JSON.stringify({ builtin, results })}\n`);
process.exit(0);
