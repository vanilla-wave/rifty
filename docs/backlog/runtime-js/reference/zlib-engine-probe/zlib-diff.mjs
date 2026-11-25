// Entry criterion of the goal's lib/zlib.js unit: Node v24.16.0's own lib/zlib.js, loaded verbatim
// from the sha256-pinned tarball (not a port), over the probe handle (wasm engine), with `stream`
// resolved to Node's Transform (port/N) or rifty's @riftydev/io Transform (port/R). Every zlib path's
// observable state and behaviour is compared; port/N is also checked against real `node:zlib`.
// usage: node --expose-internals --import tsx zlib-diff.mjs DEPS BUILD REPO
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import nodeStream from 'node:stream';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import realZlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { makeHandleClass } = require('./handle.cjs');
const { loadEngines } = require('./engines.mjs');
const [deps, build, repo] = process.argv.slice(2);
const engine = loadEngines(deps, build)['wasm-node-zlib'];
const rifty = await import(pathToFileURL(join(repo, 'packages/io/src/index.ts')).href);
const SRC = readFileSync(join(deps, 'node-src/node-v24.16.0/lib/zlib.js'), 'utf8');
const { internalBinding, primordials } = require('internal/test/binding');

/** lib/zlib.js as Node compiles it: (exports, require, module, process, internalBinding, primordials). */
function loadLibZlib(stream) {
  const zb = internalBinding('zlib');
  const binding = Object.assign(Object.create(zb), { Zlib: makeHandleClass(engine) });
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
  node: realZlib,
  'port/N': loadLibZlib({ Transform: nodeStream.Transform, finished: nodeStream.finished }),
  'port/R': loadLibZlib({ Transform: rifty.Transform, finished: rifty.finished }),
};
const C = realZlib.constants;
const T = Buffer.from('the quick brown fox jumps over the lazy dog '.repeat(3000));
const Z = realZlib.deflateSync(T);
const BAD = Buffer.from(Z);
BAD[40] ^= 0x55;
const tick = () => new Promise((r) => setTimeout(r, 20));
const short = (v) => {
  if (v instanceof Error)
    return `${v.name}${v.code ? ` [${v.code}]` : ''}: ${v.message.split('\n')[0].slice(0, 70)}`;
  if (Buffer.isBuffer(v)) return `Buffer(${v.length})`;
  return v;
};
const attempt = (f) => {
  try {
    return { ok: short(f()) };
  } catch (e) {
    return { throw: short(e) };
  }
};
/** Observable stream state, the fields a consumer can read. */
const snap = (e) => ({
  destroyed: e.destroyed,
  errored: short(e.errored ?? null),
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
          ? { err: short(err) }
          : {
              ok: r?.engine
                ? {
                    buffer: short(r.buffer),
                    engineIsDeflate: r.engine instanceof r.engine.constructor,
                  }
                : short(r),
            },
      ),
    ),
  );

const SCENARIOS = {
  'ctor deflateSync({highWaterMark: -1})': async (z) =>
    attempt(() => z.deflateSync('abc', { highWaterMark: -1 })),
  'ctor deflateSync({signal: 1})': async (z) => attempt(() => z.deflateSync('abc', { signal: 1 })),
  'ctor deflateSync({chunkSize: 10})': async (z) =>
    attempt(() => z.deflateSync('abc', { chunkSize: 10 })),
  'ctor deflateSync({objectMode: true, encoding: "hex"})': async (z) =>
    attempt(() => z.deflateSync('abc', { objectMode: true, encoding: 'hex' })),
  'sync success: _processChunk then state': async (z) => {
    const e = new z.Deflate();
    const r = attempt(() => e._processChunk(T, C.Z_FINISH));
    const s1 = snap(e);
    await tick();
    return { r, sync: s1, later: snap(e) };
  },
  'sync error: _processChunk(BAD), state, reset(), again': async (z) => {
    const e = new z.Inflate();
    const t = [];
    watch(e, t);
    e.on('error', () => {});
    const r = attempt(() => e._processChunk(BAD, C.Z_FINISH));
    const s1 = snap(e);
    await tick();
    const s2 = snap(e);
    const reset = attempt(() => e.reset());
    const again = attempt(() => e._processChunk(Z, C.Z_FINISH));
    return { r, sync: s1, later: s2, reset, again, trace: t };
  },
  'inflateSync({maxOutputLength: 1000})': async (z) =>
    attempt(() => z.inflateSync(Z, { maxOutputLength: 1000 })),
  'gzipSync({info: true}).engine state': async (z) => {
    const r = z.gzipSync(T, { info: true });
    return { buffer: short(r.buffer), isGzip: r.engine instanceof z.Gzip, engine: snap(r.engine) };
  },
  'close() then _processChunk next tick': async (z) => {
    const e = new z.Deflate();
    e.close();
    await tick();
    return { r: attempt(() => e._processChunk(T, C.Z_FINISH)), state: snap(e) };
  },
  'close(cb)': async (z) => {
    const e = new z.Deflate();
    const r = await new Promise((res) => e.close((err) => res(err ? short(err) : 'cb()')));
    return { r, state: snap(e) };
  },
  'callback deflate success, info: true': async (z) => cb((k) => z.deflate(T, { info: true }, k)),
  'callback inflate error': async (z) => cb((k) => z.inflate(BAD, k)),
  'callback inflate maxOutputLength 1000': async (z) =>
    cb((k) => z.inflate(Z, { maxOutputLength: 1000 }, k)),
  'callback engine trace (deflate success)': async (z) => {
    const e = new z.Deflate();
    const t = [];
    watch(e, t);
    const out = [];
    e.on('data', (d) => out.push(d));
    await new Promise((r) => {
      e.on('end', r);
      e.end(T);
    });
    await tick();
    return { bytes: Buffer.concat(out).length, trace: t, state: snap(e) };
  },
  'stream: write, params, flush, reset, end': async (z) => {
    const d = z.createDeflate();
    const out = [];
    d.on('data', (x) => out.push(x));
    const done = new Promise((r) => d.on('end', r));
    await new Promise((r) => d.write(T.subarray(0, 50000), r));
    await new Promise((r) => d.params(1, 0, r));
    await new Promise((r) => d.flush(C.Z_SYNC_FLUSH, r));
    const reset = attempt(() => d.reset());
    d.end(T.subarray(50000));
    await done;
    return { bytes: Buffer.concat(out).length, reset, state: snap(d) };
  },
  'stream: destroy mid-write': async (z) => {
    const d = z.createGzip();
    const t = [];
    watch(d, t);
    d.write(T);
    d.destroy();
    await tick();
    return { trace: t, state: snap(d) };
  },
};

const results = {};
for (const [name, run] of Object.entries(SCENARIOS)) {
  results[name] = {};
  for (const [col, z] of Object.entries(COLS)) {
    try {
      results[name][col] = await Promise.race([
        run(z),
        new Promise((r) => setTimeout(() => r({ timeout: true }), 4000)),
      ]);
    } catch (e) {
      results[name][col] = { scenarioThrew: short(e) };
    }
  }
}
// The only expected node ≠ port/N field: the handle class (native vs probe) — none is observed here.
function diffKeys(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a))
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
      diffKeys(a[k], b[k], path ? `${path}.${k}` : k),
    );
  return [`${path || '(value)'}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}
console.log(
  `node ${process.version}; lib/zlib.js verbatim from node-v24.16.0.tar.xz; rifty Transform from packages/io/src (main)`,
);
let portN = 0;
let rDiff = 0;
let rFields = 0;
console.log('\n| scenario | port/N = node | port/R vs port/N (rifty differences) |\n|---|---|---|');
for (const [name, r] of Object.entries(results)) {
  const n = diffKeys(r.node, r['port/N']);
  const d = diffKeys(r['port/N'], r['port/R']);
  if (n.length === 0) portN++;
  if (d.length) rDiff++;
  rFields += d.length;
  console.log(
    `| ${name} | ${n.length ? `NO: ${n.join('; ')}` : 'yes'} | ${d.length ? d.join('; ') : '0'} |`,
  );
}
console.log(
  `\nport/N = node: ${portN}/${Object.keys(results).length} scenarios; port/R ≠ port/N: ${rDiff}/${Object.keys(results).length} scenarios, ${rFields} fields`,
);
process.exit(0);
