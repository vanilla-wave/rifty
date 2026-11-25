// Bytes JS copies into and out of the engine's memory while Node v24.16.0's own lib/zlib.js (the
// pinned fixture, with Node's `stream`) runs over the product handle: sync, callback and stream
// forms. Prints [{ name, input, output, copiedIn, copiedOut }].
// usage: node --expose-internals --import tsx copy-count.mjs
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

const engine = new ZlibEngine(zlibWasmBytes());
const count = { in: 0, out: 0 };
const heap = engine.heap.bind(engine);
engine.heap = () => {
  const h = heap();
  const set = h.set.bind(h);
  const sub = h.subarray.bind(h);
  h.set = (src, at) => {
    count.in += src.length;
    set(src, at);
  };
  h.subarray = (a, b) => {
    const v = sub(a, b);
    count.out += v.length;
    return v;
  };
  return h;
};
const product = createZlibBinding(() => engine, setImmediate);
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
  require,
  module,
  process,
  (n) => (n === 'zlib' ? binding : internalBinding(n)),
  primordials,
);
const z = module.exports;

const stored = realZlib.deflateRawSync(randomBytes(16 << 20), { level: 0 });
const gz = realZlib.gzipSync(randomBytes(4 << 20), { level: 1 });
const twoMembers = Buffer.concat([gz, gz]);
const cb = (f) => new Promise((res, rej) => f((e, r) => (e ? rej(e) : res(r))));
const SCENARIOS = {
  'inflateRawSync 16 MiB stored': async () => [stored, z.inflateRawSync(stored)],
  'inflateRaw (callback) 16 MiB stored': async () => [
    stored,
    await cb((k) => z.inflateRaw(stored, k)),
  ],
  'gunzip (callback) 2 members × 4 MiB': async () => [
    twoMembers,
    await cb((k) => z.gunzip(twoMembers, k)),
  ],
  'createInflateRaw stream 16 MiB stored': async () =>
    new Promise((res) => {
      const s = z.createInflateRaw();
      const o = [];
      s.on('data', (d) => o.push(d));
      s.on('end', () => res([stored, Buffer.concat(o)]));
      s.end(stored);
    }),
  'createGzip chunkSize 1 MiB, 4000 writes of 100 B': async () =>
    new Promise((res) => {
      const parts = Array.from({ length: 4000 }, (_, i) => Buffer.from(String(i).padEnd(100, '.')));
      const s = z.createGzip({ chunkSize: 1 << 20 });
      const o = [];
      s.on('data', (d) => o.push(d));
      s.on('end', () => res([Buffer.concat(parts), Buffer.concat(o)]));
      for (const part of parts) s.write(part);
      s.end();
    }),
  'deflate/inflate with a 32 KiB dictionary, 8 MiB': async () => {
    const dictionary = randomBytes(32 * 1024);
    const r = Buffer.concat([dictionary, randomBytes(8 << 20)]);
    const c = z.deflateSync(r, { dictionary, level: 1 });
    const back = z.inflateSync(c, { dictionary });
    // in: the input + the dictionary once per stream; out: the output of both directions.
    return [Buffer.concat([r, dictionary, c, dictionary]), Buffer.concat([c, back])];
  },
  'createDeflate: params() mid-stream, then a flush() per write': async () =>
    new Promise((res) => {
      const parts = Array.from({ length: 200 }, (_, i) => randomBytes(4096 + i));
      const s = z.createDeflate();
      const o = [];
      s.on('data', (d) => o.push(d));
      s.on('end', () => res([Buffer.concat(parts), Buffer.concat(o)]));
      const go = async () => {
        for (const [i, part] of parts.entries()) {
          if (i === 100) await new Promise((k) => s.params(1, 1, k));
          s.write(part);
          await new Promise((k) => s.flush(k));
        }
        s.end();
      };
      go();
    }),
  'deflateRawSync 16 MiB random': async () => {
    const r = randomBytes(16 << 20);
    return [r, z.deflateRawSync(r, { level: 1 })];
  },
};
const out = [];
for (const [name, run] of Object.entries(SCENARIOS)) {
  count.in = 0;
  count.out = 0;
  const [input, output] = await run();
  out.push({
    name,
    input: input.length,
    output: output.length,
    copiedIn: count.in,
    copiedOut: count.out,
  });
}
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(0);
