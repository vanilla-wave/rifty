// Controls without a z_stream API (fflate, wasm-flate): only their own one-shot calls can be
// measured. usage: node highlevel.mjs DEPS
import { createRequire } from 'node:module';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { corpus, prng } from './corpus.mjs';

const [deps] = process.argv.slice(2);
const req = createRequire(join(deps, 'fflate/package/package.json'));
const ff = req('./lib/node.cjs');
import { readFileSync } from 'node:fs';
globalThis.self = globalThis; // its wasm-bindgen no-modules glue publishes on `self`, async init only
createRequire(join(deps, 'wasm-flate/package/package.json'))('./wasm_flate.js');
const wf = globalThis.wasm_bindgen;
await wf(readFileSync(join(deps, 'wasm-flate/package/wasm_flate_bg.wasm')));
const CORPUS = corpus();
const T = CORPUS.text64k;
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const tryIt = (f) => {
  try {
    return { ok: Buffer.from(f()) };
  } catch (e) {
    return { err: e.message, code: e.code };
  }
};
const outcomeEq = (n, m) => (n.ok && m.ok ? eq(n.ok, m.ok) : !n.ok && !m.ok && n.err === m.err);

const rows = [];
const row = (engine, check, pass, n, note = '') =>
  rows.push({ engine, check, result: `${pass}/${n}`, note });

// fflate
{
  let p = 0;
  let n = 0;
  for (const level of [0, 1, 6, 9])
    for (const input of Object.values(CORPUS)) {
      n++;
      if (eq(ff.deflateSync(input, { level }), zlib.deflateRawSync(input, { level }))) p++;
    }
  row('fflate@0.8.3', 'deflateRaw bytes = Node (levels 0/1/6/9 × corpus)', p, n);
  const v = zlib.deflateSync(T);
  const g = zlib.gzipSync(T);
  row('fflate@0.8.3', 'inflate valid', +eq(ff.unzlibSync(v), T), 1);
  const tails = [Buffer.from('\n'), Buffer.from('JUNK!'), Buffer.alloc(8)];
  p = 0;
  for (const t of tails) {
    const n_ = tryIt(() => zlib.inflateSync(Buffer.concat([v, t])));
    const m = tryIt(() => ff.unzlibSync(Buffer.concat([v, t])));
    if (outcomeEq(n_, m)) p++;
  }
  row('fflate@0.8.3', 'inflate + tail (\\n, JUNK!, 8×0) as Node', p, 3);
  const g2 = Buffer.concat([zlib.gzipSync('a'), zlib.gzipSync('b')]);
  const m2 = tryIt(() => ff.gunzipSync(g2));
  row(
    'fflate@0.8.3',
    'gunzip 2 members as Node',
    +(m2.ok && m2.ok.toString() === 'ab'),
    1,
    m2.ok ? `got ${JSON.stringify(m2.ok.toString())}` : m2.err,
  );
  const r = prng(42);
  let same = 0;
  let sameMsg = 0;
  const total = 300;
  for (let i = 0; i < total; i++) {
    const b = Buffer.from(g);
    b[Math.floor(r() * b.length)] = Math.floor(r() * 256);
    const n_ = tryIt(() => zlib.gunzipSync(b));
    const m = tryIt(() => ff.gunzipSync(b));
    if (!!n_.ok === !!m.ok && (!n_.ok || eq(n_.ok, m.ok))) same++;
    if (outcomeEq(n_, m)) sameMsg++;
  }
  row('fflate@0.8.3', 'gunzip fuzz: same ok/error class', same, total);
  row(
    'fflate@0.8.3',
    'gunzip fuzz: same error text',
    sameMsg,
    total,
    'fflate texts: "invalid block type", "unexpected EOF", …',
  );
  row(
    'fflate@0.8.3',
    'z_stream primitives (params/reset/windowBits/memLevel 1-9/Z_FULL_FLUSH/Z_BLOCK/strategy)',
    0,
    7,
    'API has level, mem, dictionary, flush(sync) only',
  );
}
// wasm-flate
{
  let p = 0;
  let n = 0;
  for (const input of Object.values(CORPUS)) {
    n++;
    if (input.length && eq(wf.deflate_encode_raw(input), zlib.deflateRawSync(input))) p++;
  }
  row(
    'wasm-flate@1.0.2-browser',
    'deflateRaw bytes = Node (default level × corpus)',
    p,
    n,
    'no level/stream/dictionary API; 161 KB wasm',
  );
  const v = zlib.deflateSync(T);
  const m = tryIt(() => wf.zlib_decode_raw(Buffer.concat([v, Buffer.from('JUNK!')])));
  row(
    'wasm-flate@1.0.2-browser',
    'inflate + JUNK! as Node',
    +(m.ok && eq(m.ok, T)),
    1,
    m.err ?? '',
  );
}
console.log(`node ${process.version}`);
for (const r of rows)
  console.log(`${r.engine} | ${r.check} | ${r.result}${r.note ? ` | ${r.note}` : ''}`);
