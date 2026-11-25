// Behaviour matrix: every case runs on real Node (oracle) and on each z_stream engine through the
// same node_zlib.cc port (driver.mjs). usage: node cases.mjs DEPS BUILD [--json OUT]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { corpus, prng } from './corpus.mjs';
import { Context, oneShotSync } from './driver.mjs';
import { Unsupported, loadEngines } from './engines.mjs';

const [deps, build] = process.argv.slice(2);
const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null;
const C = zlib.constants;
const src = Buffer.concat(
  ['deflate.c', 'inflate.c', 'trees.c'].map((f) =>
    readFileSync(join(deps, 'node-src/node-v24.16.0/deps/zlib', f)),
  ),
);
const CORPUS = corpus(src);
const engines = loadEngines(deps, build);

const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
// Node's gzip header OS byte is the build's OS_CODE (19 macOS, 10 Windows, 3 elsewhere: deps/zlib/zutil.h);
// every engine here writes 3. A byte that differs only there (each member header, `1f 8b 08` + 6) passes.
async function outcome(fn) {
  try {
    const r = await fn();
    return { ok: Buffer.from(r), starts: r.memberStarts ?? [0] };
  } catch (e) {
    if (e instanceof Unsupported) return { unsupported: e.message };
    return { err: e.message, name: e.name, code: e.code, errno: e.errno };
  }
}
const OS_CODES = new Set([3, 10, 19]);
// Only at a gzip member header's OS byte (member starts as the engine side wrote them).
function sameBytes(n, m, starts) {
  if (n.length !== m.length) return false;
  const osAt = new Set(starts.filter((s) => m[s] === 0x1f && m[s + 1] === 0x8b).map((s) => s + 9));
  for (let i = 0; i < n.length; i++)
    if (n[i] !== m[i] && !(osAt.has(i) && OS_CODES.has(n[i]) && m[i] === 3)) return false;
  return true;
}
const show = (o) => (o.ok ? { ok: `${o.ok.length}:${sha(o.ok)}` } : o);
const same = (a, b) =>
  a.ok && b.ok ? sameBytes(b.ok, a.ok, a.starts) : JSON.stringify(a) === JSON.stringify(b);

const NODE_CTOR = {
  DEFLATE: zlib.Deflate,
  INFLATE: zlib.Inflate,
  GZIP: zlib.Gzip,
  GUNZIP: zlib.Gunzip,
  DEFLATERAW: zlib.DeflateRaw,
  INFLATERAW: zlib.InflateRaw,
  UNZIP: zlib.Unzip,
};
const NODE_SYNC = {
  DEFLATE: zlib.deflateSync,
  INFLATE: zlib.inflateSync,
  GZIP: zlib.gzipSync,
  GUNZIP: zlib.gunzipSync,
  DEFLATERAW: zlib.deflateRawSync,
  INFLATERAW: zlib.inflateRawSync,
  UNZIP: zlib.unzipSync,
};

// steps: { write } (opts.flush is the per-write flag) | { flush: kind } | { params: [l, s] } | { reset: true };
// end() always. Node side: the public async stream API, each step awaited.
async function nodeSteps(mode, opts, steps) {
  const z = new NODE_CTOR[mode](opts);
  const out = [];
  let error = null;
  z.on('data', (d) => out.push(d));
  z.on('error', (e) => {
    error = e;
  });
  const done = new Promise((res) => {
    z.on('end', res);
    z.on('error', res);
    z.on('close', res);
  });
  const wait = (fn) =>
    Promise.race([
      new Promise((res) => {
        fn(res);
      }),
      done,
    ]);
  for (const s of steps) {
    if (error) break;
    if (s.params) await wait((cb) => z.params(...s.params, cb));
    else if (s.reset) z.reset();
    else if (s.flush !== undefined) await wait((cb) => z.flush(s.flush, cb));
    else await wait((cb) => z.write(Buffer.from(s.write), cb));
  }
  if (!error) z.end();
  await done;
  if (error) throw error;
  return Buffer.concat(out);
}
function engineSteps(engine, mode, opts, steps) {
  const ctx = new Context(engine, mode, opts);
  const def = opts.flush ?? C.Z_NO_FLUSH;
  const E = new Uint8Array(0);
  const out = [];
  const starts = [0];
  try {
    for (const s of steps) {
      if (s.params) {
        out.push(ctx.processChunkSync(E, C.Z_SYNC_FLUSH));
        ctx.params(...s.params);
      } else if (s.reset) {
        ctx.reset();
        starts.push(out.reduce((a, b) => a + b.length, 0)); // a gzip reset starts a new member
      } else if (s.flush !== undefined) out.push(ctx.processChunkSync(E, s.flush));
      else out.push(ctx.processChunkSync(s.write, def));
    }
    out.push(ctx.processChunkSync(E, ctx.finishFlush));
  } finally {
    ctx.close();
  }
  return Object.assign(Buffer.concat(out), { memberStarts: starts });
}
const chunks = (b, n) => {
  const a = [];
  for (let i = 0; i < b.length; i += n) a.push(b.subarray(i, i + n));
  return a;
};
const cat = (...xs) => Buffer.concat(xs.map((x) => Buffer.from(x)));

const cases = [];
const oneShot = (group, name, mode, input, opts = {}) =>
  cases.push({
    group,
    name,
    node: () => NODE_SYNC[mode](Buffer.from(input), opts),
    engine: (e) => oneShotSync(e, mode, input, opts),
  });
const stepped = (group, name, mode, opts, steps) =>
  cases.push({
    group,
    name,
    node: () => nodeSteps(mode, opts, steps),
    engine: (e) => engineSteps(e, mode, opts, steps),
  });
const writes = (parts) => parts.map((write) => ({ write }));

// 1. Compressed bytes, one-shot, by format × level × input.
for (const mode of ['DEFLATE', 'GZIP', 'DEFLATERAW'])
  for (const level of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (const [cn, input] of Object.entries(CORPUS))
      oneShot('compress-level', `${mode} L${level} ${cn}`, mode, input, { level });
// 2. strategy / memLevel / windowBits / chunkSize.
for (const strategy of [1, 2, 3, 4])
  for (const [cn, input] of Object.entries(CORPUS))
    oneShot('compress-strategy', `DEFLATE s${strategy} ${cn}`, 'DEFLATE', input, { strategy });
for (const memLevel of [1, 4, 9])
  for (const windowBits of [9, 12, 15])
    for (const cn of ['text64k', 'mixed300k', 'zlibSrc'])
      oneShot(
        'compress-mem-window',
        `DEFLATE m${memLevel} w${windowBits} ${cn}`,
        'DEFLATE',
        CORPUS[cn],
        { memLevel, windowBits },
      );
// windowBits 8: zlib's deflateInit2 takes it as 9 for the zlib wrapper; lib/zlib.js maps raw 8 → 9 itself.
oneShot('compress-mem-window', 'DEFLATE w8', 'DEFLATE', CORPUS.text64k, { windowBits: 8 });
cases.push({
  group: 'compress-mem-window',
  name: 'DEFLATERAW w8 (lib maps → 9)',
  node: () => zlib.deflateRawSync(Buffer.from(CORPUS.text64k), { windowBits: 8 }),
  engine: (e) => oneShotSync(e, 'DEFLATERAW', CORPUS.text64k, { windowBits: 9 }),
});
for (const chunkSize of [64, 1024, 65536])
  for (const level of [0, 6])
    oneShot(
      'compress-chunksize',
      `DEFLATERAW L${level} cs${chunkSize}`,
      'DEFLATERAW',
      CORPUS.text64k,
      { level, chunkSize },
    );
// 3. Streaming compress: flush modes, params(), reset(), dictionary.
const parts = chunks(CORPUS.mixed300k, 7000);
for (const [fname, flush] of Object.entries({
  NO: C.Z_NO_FLUSH,
  PARTIAL: C.Z_PARTIAL_FLUSH,
  SYNC: C.Z_SYNC_FLUSH,
  FULL: C.Z_FULL_FLUSH,
  BLOCK: C.Z_BLOCK,
}))
  for (const level of [0, 1, 6, 9])
    stepped(
      'compress-stream-flush',
      `DEFLATERAW L${level} each-write ${fname}`,
      'DEFLATERAW',
      { level, flush },
      writes(parts),
    );
for (const level of [0, 6])
  stepped(
    'compress-stream-flush',
    `DEFLATE L${level} write, flush(SYNC), write, flush(FULL)`,
    'DEFLATE',
    { level },
    [
      { write: parts[0] },
      { flush: C.Z_SYNC_FLUSH },
      { write: parts[1] },
      { flush: C.Z_FULL_FLUSH },
      { write: parts[2] },
    ],
  );
for (const [a, b] of [
  [
    [6, 0],
    [1, 0],
  ],
  [
    [6, 0],
    [9, 1],
  ],
  [
    [0, 0],
    [6, 0],
  ],
  [
    [6, 0],
    [0, 0],
  ],
  [
    [1, 0],
    [6, 3],
  ],
])
  stepped(
    'compress-params',
    `DEFLATE L${a[0]}s${a[1]} → params(${b})`,
    'DEFLATE',
    { level: a[0], strategy: a[1] },
    [{ write: parts[0] }, { params: b }, { write: parts[1] }, { write: parts[2] }],
  );
stepped('compress-reset', 'GZIP reset after flush', 'GZIP', {}, [
  { write: parts[0] },
  { flush: C.Z_FULL_FLUSH },
  { reset: true },
  { write: parts[1] },
]);
stepped(
  'compress-reset',
  'DEFLATE dictionary reset after flush',
  'DEFLATE',
  { dictionary: CORPUS.text64k.subarray(0, 2048) },
  [{ write: parts[0] }, { flush: C.Z_FULL_FLUSH }, { reset: true }, { write: parts[1] }],
);
const dict = CORPUS.text64k.subarray(0, 2048);
for (const mode of ['DEFLATE', 'DEFLATERAW'])
  oneShot('compress-dictionary', `${mode} dictionary`, mode, CORPUS.text64k.subarray(1000, 20000), {
    dictionary: dict,
  });

// 4. Decompression edges (one-shot) — inputs made by real Node.
const T = CORPUS.text64k;
const z = {
  DEFLATE: zlib.deflateSync(T),
  GZIP: zlib.gzipSync(T),
  DEFLATERAW: zlib.deflateRawSync(T),
};
const inv = { DEFLATE: 'INFLATE', GZIP: 'GUNZIP', DEFLATERAW: 'INFLATERAW' };
const tails = {
  lf: '\n',
  crlf: '\r\n',
  junk: 'JUNK!',
  zeros8: new Uint8Array(8),
  byte1f: new Uint8Array([0x1f]),
  gzipHeaderOnly: z.GZIP.subarray(0, 10),
};
for (const fmt of ['DEFLATE', 'GZIP', 'DEFLATERAW']) {
  const m = inv[fmt];
  const v = z[fmt];
  oneShot('inflate-valid', `${m} valid`, m, v);
  for (const [tn, t] of Object.entries(tails))
    oneShot(
      'inflate-trailing',
      `${m} + ${tn}`,
      m,
      cat(v, typeof t === 'string' ? Buffer.from(t) : t),
    );
  for (const cut of [0, 1, 2, 3, 10, Math.floor(v.length / 2), v.length - 4, v.length - 1])
    oneShot('inflate-truncated', `${m} truncated @${cut}`, m, v.subarray(0, cut));
  for (const cut of [Math.floor(v.length / 2), v.length - 1])
    oneShot(
      'inflate-finishFlush',
      `${m} truncated @${cut} finishFlush SYNC`,
      m,
      v.subarray(0, cut),
      { finishFlush: C.Z_SYNC_FLUSH },
    );
  for (const pos of [0, 1, 2, 3, 9, 20, 200, v.length - 8, v.length - 4, v.length - 1]) {
    const b = Buffer.from(v);
    b[pos] ^= 0x55;
    oneShot('inflate-corrupt', `${m} flip @${pos}`, m, b);
  }
  oneShot('inflate-maxOutputLength', `${m} maxOutputLength 1000`, m, v, { maxOutputLength: 1000 });
  for (const cs of [64, 1024])
    oneShot('inflate-chunksize', `${m} chunkSize ${cs}`, m, v, { chunkSize: cs });
  stepped('inflate-stream', `${m} 1-byte writes`, m, {}, writes(chunks(v, 1)));
  stepped(
    'inflate-stream',
    `${m} 997-byte writes, flush SYNC`,
    m,
    { flush: C.Z_SYNC_FLUSH },
    writes(chunks(v, 997)),
  );
  stepped(
    'inflate-stream',
    `${m} 997-byte writes + junk tail`,
    m,
    {},
    writes(chunks(cat(v, Buffer.from('JUNK!')), 997)),
  );
  stepped(
    'inflate-stream',
    `${m} truncated stream`,
    m,
    {},
    writes(chunks(v.subarray(0, v.length - 5), 997)),
  );
}
const g2 = cat(zlib.gzipSync('first member '), zlib.gzipSync('second member'));
oneShot('gunzip-members', 'GUNZIP 2 members', 'GUNZIP', g2);
oneShot(
  'gunzip-members',
  'GUNZIP member + zeros + member',
  'GUNZIP',
  cat(zlib.gzipSync('a'), new Uint8Array(4), zlib.gzipSync('b')),
);
oneShot(
  'gunzip-members',
  'GUNZIP member + junk member',
  'GUNZIP',
  cat(zlib.gzipSync('a'), Buffer.from('JUNK!'), zlib.gzipSync('b')),
);
oneShot('gunzip-members', 'UNZIP 2 members', 'UNZIP', g2);
stepped('gunzip-members', 'GUNZIP 2 members, 5-byte writes', 'GUNZIP', {}, writes(chunks(g2, 5)));
// windowBits: mismatch, autodetect (0), unzip.
for (const wb of [9, 12])
  oneShot('inflate-windowBits', `INFLATE wb${wb} of w15 stream`, 'INFLATE', z.DEFLATE, {
    windowBits: wb,
  });
oneShot('inflate-windowBits', 'INFLATE wb0 auto (w15)', 'INFLATE', z.DEFLATE, { windowBits: 0 });
oneShot(
  'inflate-windowBits',
  'INFLATE wb0 auto (w9)',
  'INFLATE',
  zlib.deflateSync(T, { windowBits: 9 }),
  { windowBits: 0 },
);
oneShot('inflate-windowBits', 'GUNZIP wb0', 'GUNZIP', z.GZIP, { windowBits: 0 });
oneShot('inflate-windowBits', 'INFLATERAW wb9 of w15 stream', 'INFLATERAW', z.DEFLATERAW, {
  windowBits: 9,
});
for (const fmt of ['DEFLATE', 'GZIP', 'DEFLATERAW'])
  oneShot('unzip', `UNZIP of ${fmt}`, 'UNZIP', z[fmt]);
oneShot('unzip', 'UNZIP of 1 byte 0x1f', 'UNZIP', new Uint8Array([0x1f]));
stepped(
  'unzip',
  'UNZIP gzip split after 1f',
  'UNZIP',
  {},
  writes([z.GZIP.subarray(0, 1), z.GZIP.subarray(1)]),
);
oneShot('inflate-wrong-format', 'INFLATE of raw', 'INFLATE', z.DEFLATERAW);
oneShot('inflate-wrong-format', 'GUNZIP of zlib', 'GUNZIP', z.DEFLATE);
oneShot('inflate-wrong-format', 'INFLATERAW of zlib', 'INFLATERAW', z.DEFLATE);
// dictionary
const dz = zlib.deflateSync(T, { dictionary: dict });
const drz = zlib.deflateRawSync(T, { dictionary: dict });
oneShot('inflate-dictionary', 'INFLATE dict ok', 'INFLATE', dz, { dictionary: dict });
oneShot('inflate-dictionary', 'INFLATE dict missing', 'INFLATE', dz);
oneShot('inflate-dictionary', 'INFLATE dict wrong', 'INFLATE', dz, {
  dictionary: Buffer.from('nope'),
});
oneShot('inflate-dictionary', 'INFLATERAW dict ok', 'INFLATERAW', drz, { dictionary: dict });
oneShot('inflate-dictionary', 'INFLATERAW dict missing', 'INFLATERAW', drz);

// crc32(data, value): Node's zlib.crc32 vs the engine's own crc32 (pako 3 exports none → unsupported).
for (const [cn, input] of Object.entries(CORPUS))
  for (const value of [0, 1, 0xffffffff, 0x12345678])
    cases.push({
      group: 'crc32',
      name: `crc32 ${cn} ${value}`,
      node: () => Buffer.from(String(zlib.crc32(input, value))),
      engine: (e) => {
        if (!e.crc32) throw new Unsupported('crc32');
        return Buffer.from(String(e.crc32(value, input)));
      },
    });

// 5. Seeded corruption fuzz.
const r = prng(42);
for (const fmt of ['DEFLATE', 'GZIP', 'DEFLATERAW']) {
  const v = zlib[{ DEFLATE: 'deflateSync', GZIP: 'gzipSync', DEFLATERAW: 'deflateRawSync' }[fmt]](
    CORPUS.mixed300k.subarray(0, 20000),
  );
  for (let i = 0; i < 300; i++) {
    const b = Buffer.from(v);
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) b[Math.floor(r() * b.length)] = Math.floor(r() * 256);
    oneShot('inflate-fuzz', `${inv[fmt]} fuzz ${i}`, inv[fmt], b);
  }
}

// Run.
const results = {};
const node = [];
for (const c of cases) {
  if (process.env.PROBE_TRACE) console.error(c.name);
  node.push(await outcome(c.node));
}
for (const [en, eng] of Object.entries(engines)) {
  const groups = {};
  for (const [i, c] of cases.entries()) {
    const got = await outcome(() => c.engine(eng));
    groups[c.group] ??= { pass: 0, fail: 0, unsupported: 0, diffs: [] };
    const g = groups[c.group];
    if (got.unsupported) g.unsupported++;
    else if (same(got, node[i])) g.pass++;
    else {
      g.fail++;
      if (g.diffs.length < 4)
        g.diffs.push({ case: c.name, node: show(node[i]), engine: show(got) });
    }
  }
  results[en] = groups;
}
const groupNames = [...new Set(cases.map((c) => c.group))];
console.log(`node ${process.version} zlib ${process.versions.zlib}; cases ${cases.length}`);
console.log(['group', 'n', ...Object.keys(engines)].join(' | '));
for (const g of groupNames) {
  const n = cases.filter((c) => c.group === g).length;
  console.log(
    [
      g,
      n,
      ...Object.keys(engines).map((e) => {
        const x = results[e][g];
        return x.fail || x.unsupported
          ? `${x.pass}/${n}${x.unsupported ? ` (${x.unsupported} unsup)` : ''}`
          : 'all';
      }),
    ].join(' | '),
  );
}
if (jsonOut)
  writeFileSync(
    jsonOut,
    JSON.stringify(
      { node: process.version, zlib: process.versions.zlib, cases: cases.length, results },
      null,
      1,
    ),
  );
