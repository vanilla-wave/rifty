// An intermediate state the goal measured and dropped (no state with two engines): `gzipSync` etc. on the wasm engine (= Node's bytes,
// matrix) next to `gzip(x, cb)` etc. still on Chromium's CompressionStream/DecompressionStream
// (ADR-0159). Bytes and decode outcomes compared per case. usage: node async-vs-sync.mjs DEPS BUILD REPO
import { createRequire } from 'node:module';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { corpus } from './corpus.mjs';
import { oneShotSync } from './driver.mjs';
import { loadEngines } from './engines.mjs';

const [deps, build, repo] = process.argv.slice(2);
const { chromium } = createRequire(join(repo, 'package.json'))('@playwright/test');
const wasm = loadEngines(deps, build)['wasm-node-zlib'];
const C = corpus();
const FMT = { GZIP: 'gzip', DEFLATE: 'deflate', DEFLATERAW: 'deflate-raw' };
const INV = { GZIP: 'GUNZIP', DEFLATE: 'INFLATE', DEFLATERAW: 'INFLATERAW' };
const compressCases = [];
for (const mode of ['GZIP', 'DEFLATE', 'DEFLATERAW'])
  for (const cn of ['tiny', 'text64k', 'json100k', 'random16k', 'mixed300k'])
    for (const level of [-1, 1, 9]) compressCases.push({ mode, cn, level });
const g = zlib.gzipSync(C.text64k);
const z = zlib.deflateSync(C.text64k);
const decodeCases = [
  {
    name: 'gunzip 2 members',
    mode: 'GUNZIP',
    fmt: 'gzip',
    input: Buffer.concat([g, zlib.gzipSync('tail')]),
  },
  {
    name: 'gunzip + 8×0x00',
    mode: 'GUNZIP',
    fmt: 'gzip',
    input: Buffer.concat([g, Buffer.alloc(8)]),
  },
  {
    name: 'inflate + LF',
    mode: 'INFLATE',
    fmt: 'deflate',
    input: Buffer.concat([z, Buffer.from('\n')]),
  },
  {
    name: 'inflate + JUNK!',
    mode: 'INFLATE',
    fmt: 'deflate',
    input: Buffer.concat([z, Buffer.from('JUNK!')]),
  },
  {
    name: 'inflate truncated',
    mode: 'INFLATE',
    fmt: 'deflate',
    input: z.subarray(0, z.length - 4),
  },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const web = await page.evaluate(
  async ({ comp, dec }) => {
    const run = async (S, fmt, bytes) => {
      const s = new S(fmt);
      const w = s.writable.getWriter();
      w.write(new Uint8Array(bytes)).catch(() => {});
      w.close().catch(() => {});
      const r = s.readable.getReader();
      const parts = [];
      try {
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          parts.push(...value);
        }
        return { ok: parts };
      } catch (e) {
        return { err: `${e.name}: ${e.message}`, before: parts.length };
      }
    };
    const out = { comp: [], dec: [] };
    for (const c of comp) out.comp.push(await run(CompressionStream, c.fmt, c.input));
    for (const d of dec) out.dec.push(await run(DecompressionStream, d.fmt, d.input));
    return out;
  },
  {
    comp: compressCases.map((c) => ({ fmt: FMT[c.mode], input: [...C[c.cn]] })),
    dec: decodeCases.map((d) => ({ fmt: d.fmt, input: [...d.input] })),
  },
);
console.log(
  `chromium ${browser.version()}; sync = wasm engine through driver.mjs (Node's bytes per the matrix)`,
);
let same = 0;
let sameIgnoringOs = 0;
let roundTrip = 0;
const rows = [];
compressCases.forEach((c, i) => {
  const s = oneShotSync(wasm, c.mode, C[c.cn], { level: c.level });
  const a = Buffer.from(web.comp[i].ok);
  const eq = Buffer.compare(s, a) === 0;
  const os = c.mode === 'GZIP' ? a[9] : null;
  const eqOs =
    eq ||
    (c.mode === 'GZIP' &&
      a.length === s.length &&
      Buffer.compare(
        Buffer.concat([a.subarray(0, 9), a.subarray(10)]),
        Buffer.concat([s.subarray(0, 9), s.subarray(10)]),
      ) === 0);
  const back = oneShotSync(wasm, INV[c.mode], a, {});
  if (eq) same++;
  if (eqOs) sameIgnoringOs++;
  if (Buffer.compare(back, Buffer.from(C[c.cn])) === 0) roundTrip++;
  rows.push(
    `${c.mode} ${c.cn} L${c.level}: sync ${s.length} B, async ${a.length} B${eq ? ' same' : eqOs ? ` same but OS byte ${os}` : ' differ'}`,
  );
});
for (const r of rows) console.log(r);
console.log(
  `compress: ${same}/${compressCases.length} byte-identical, ${sameIgnoringOs}/${compressCases.length} identical but the gzip OS byte; async output decodes on the engine ${roundTrip}/${compressCases.length}`,
);
decodeCases.forEach((d, i) => {
  let s;
  try {
    s = `ok ${oneShotSync(wasm, d.mode, d.input, {}).length} B`;
  } catch (e) {
    s = `${e.code}: ${e.message}`;
  }
  const w = web.dec[i];
  console.log(
    `${d.name}: sync ${s} | async ${w.ok ? `ok ${w.ok.length} B` : `${w.err} (after ${w.before} B)`}`,
  );
});
await browser.close();
