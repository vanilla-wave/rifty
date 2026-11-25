/**
 * Unit 2 Acceptance 1 (ADR-0573): the probe's 1420-case matrix (`reference/zlib-engine-probe/
 * cases.mjs`) — live `node:zlib` (v24.16.0) vs the product handle and `crc32`, driven through the
 * handle's own API as lib/zlib.js drives it (harness.ts). Bytes compared whole (the gzip OS byte
 * only at member headers: Node writes its build's OS_CODE, the engine 3); errors by message, class,
 * `code`, `errno`.
 */
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { corpus, prng } from './corpus';
import {
  HandleStream,
  type ModeName,
  type StreamOpts,
  oneShotSync,
  productBinding,
  zlibSourceCorpus,
} from './harness';

const C = zlib.constants;
const CORPUS = corpus(zlibSourceCorpus());
const binding = productBinding();

type Outcome =
  | { ok: Buffer; starts: number[] }
  | { err: string; name: string; code: unknown; errno: unknown };
type Result = Uint8Array & { memberStarts?: number[] };

async function outcome(fn: () => Result | Promise<Result>): Promise<Outcome> {
  try {
    const r = await fn();
    return { ok: Buffer.from(r), starts: r.memberStarts ?? [0] };
  } catch (e) {
    const x = e as Error & { code?: unknown; errno?: unknown };
    return { err: x.message, name: x.name, code: x.code, errno: x.errno };
  }
}
const OS_CODES = new Set([3, 10, 19]);
function sameBytes(n: Buffer, m: Buffer, starts: number[]): boolean {
  if (n.length !== m.length) return false;
  const osAt = new Set(starts.filter((s) => m[s] === 0x1f && m[s + 1] === 0x8b).map((s) => s + 9));
  for (let i = 0; i < n.length; i++)
    if (n[i] !== m[i] && !(osAt.has(i) && OS_CODES.has(n[i]!) && m[i] === 3)) return false;
  return true;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const show = (o: Outcome) => ('ok' in o ? { ok: `${o.ok.length}:${sha(o.ok)}` } : o);
const same = (engine: Outcome, node: Outcome) =>
  'ok' in engine && 'ok' in node
    ? sameBytes(node.ok, engine.ok, engine.starts)
    : JSON.stringify(engine) === JSON.stringify(node);

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

type Step =
  | { write: Uint8Array }
  | { flush: number }
  | { params: [number, number] }
  | { reset: true };

/** Node side: the public async stream API, each step awaited; end() always. */
async function nodeSteps(mode: ModeName, opts: StreamOpts, steps: Step[]): Promise<Buffer> {
  const z = new NODE_CTOR[mode](opts as zlib.ZlibOptions);
  const out: Buffer[] = [];
  let error: Error | null = null;
  z.on('data', (d: Buffer) => out.push(d));
  z.on('error', (e) => {
    error = e;
  });
  const done = new Promise<void>((res) => {
    z.on('end', res);
    z.on('error', () => res());
    z.on('close', res);
  });
  const wait = (fn: (cb: () => void) => void) =>
    Promise.race([new Promise<void>((res) => fn(res)), done]);
  for (const s of steps) {
    if (error) break;
    if ('params' in s) await wait((cb) => (z as zlib.Deflate).params(...s.params, cb));
    else if ('reset' in s) (z as zlib.Deflate & { reset(): void }).reset();
    else if ('flush' in s) await wait((cb) => z.flush(s.flush, cb));
    else await wait((cb) => z.write(Buffer.from(s.write), cb));
  }
  if (!error) z.end();
  await done;
  if (error) throw error;
  return Buffer.concat(out);
}

/** Product side: the same steps as lib/zlib.js's sync path runs them on the handle. */
function handleSteps(mode: ModeName, opts: StreamOpts, steps: Step[]): Result {
  const s = new HandleStream(binding, mode, opts);
  const def = opts.flush ?? C.Z_NO_FLUSH;
  const E = new Uint8Array(0);
  const out: Buffer[] = [];
  const starts = [0];
  try {
    for (const st of steps) {
      if ('params' in st) {
        out.push(s.processChunkSync(E, C.Z_SYNC_FLUSH));
        s.params(...st.params);
      } else if ('reset' in st) {
        s.reset();
        starts.push(out.reduce((a, b) => a + b.length, 0)); // a gzip reset starts a new member
      } else if ('flush' in st) out.push(s.processChunkSync(E, st.flush));
      else out.push(s.processChunkSync(st.write, def));
    }
    out.push(s.processChunkSync(E, s.finishFlush));
  } finally {
    s.close();
  }
  return Object.assign(Buffer.concat(out), { memberStarts: starts });
}

interface Case {
  group: string;
  name: string;
  node: () => Result | Promise<Result>;
  engine: () => Result;
}
const chunks = (b: Uint8Array, n: number) => {
  const a: Uint8Array[] = [];
  for (let i = 0; i < b.length; i += n) a.push(b.subarray(i, i + n));
  return a;
};
const cat = (...xs: (Uint8Array | string)[]) => Buffer.concat(xs.map((x) => Buffer.from(x)));

const cases: Case[] = [];
const oneShot = (
  group: string,
  name: string,
  mode: ModeName,
  input: Uint8Array,
  opts: StreamOpts = {},
) =>
  cases.push({
    group,
    name,
    node: () => NODE_SYNC[mode](Buffer.from(input), opts as zlib.ZlibOptions),
    engine: () => oneShotSync(binding, mode, input, opts),
  });
const stepped = (group: string, name: string, mode: ModeName, opts: StreamOpts, steps: Step[]) =>
  cases.push({
    group,
    name,
    node: () => nodeSteps(mode, opts, steps),
    engine: () => handleSteps(mode, opts, steps),
  });
const writes = (parts: Uint8Array[]): Step[] => parts.map((write) => ({ write }));

// 1. Compressed bytes, one-shot, by format × level × input.
for (const mode of ['DEFLATE', 'GZIP', 'DEFLATERAW'] as const)
  for (const level of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (const [cn, input] of Object.entries(CORPUS))
      oneShot('compress-level', `${mode} L${level} ${cn}`, mode, input, { level });
// 2. strategy / memLevel / windowBits / chunkSize.
for (const strategy of [1, 2, 3, 4])
  for (const [cn, input] of Object.entries(CORPUS))
    oneShot('compress-strategy', `DEFLATE s${strategy} ${cn}`, 'DEFLATE', input, { strategy });
for (const memLevel of [1, 4, 9])
  for (const windowBits of [9, 12, 15])
    for (const cn of ['text64k', 'mixed300k', 'zlibSrc'] as const)
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
  engine: () => oneShotSync(binding, 'DEFLATERAW', CORPUS.text64k, { windowBits: 9 }),
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
      { write: parts[0]! },
      { flush: C.Z_SYNC_FLUSH },
      { write: parts[1]! },
      { flush: C.Z_FULL_FLUSH },
      { write: parts[2]! },
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
] as [[number, number], [number, number]][])
  stepped(
    'compress-params',
    `DEFLATE L${a[0]}s${a[1]} → params(${b})`,
    'DEFLATE',
    { level: a[0], strategy: a[1] },
    [{ write: parts[0]! }, { params: [b[0], b[1]] }, { write: parts[1]! }, { write: parts[2]! }],
  );
stepped('compress-reset', 'GZIP reset after flush', 'GZIP', {}, [
  { write: parts[0]! },
  { flush: C.Z_FULL_FLUSH },
  { reset: true },
  { write: parts[1]! },
]);
stepped(
  'compress-reset',
  'DEFLATE dictionary reset after flush',
  'DEFLATE',
  { dictionary: CORPUS.text64k.subarray(0, 2048) },
  [{ write: parts[0]! }, { flush: C.Z_FULL_FLUSH }, { reset: true }, { write: parts[1]! }],
);
const dict = CORPUS.text64k.subarray(0, 2048);
for (const mode of ['DEFLATE', 'DEFLATERAW'] as const)
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
const inv = { DEFLATE: 'INFLATE', GZIP: 'GUNZIP', DEFLATERAW: 'INFLATERAW' } as const;
const tails = {
  lf: '\n',
  crlf: '\r\n',
  junk: 'JUNK!',
  zeros8: new Uint8Array(8),
  byte1f: new Uint8Array([0x1f]),
  gzipHeaderOnly: z.GZIP.subarray(0, 10),
};
for (const fmt of ['DEFLATE', 'GZIP', 'DEFLATERAW'] as const) {
  const m = inv[fmt];
  const v = z[fmt];
  oneShot('inflate-valid', `${m} valid`, m, v);
  for (const [tn, t] of Object.entries(tails))
    oneShot('inflate-trailing', `${m} + ${tn}`, m, cat(v, t));
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
    b[pos]! ^= 0x55;
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
    writes(chunks(cat(v, 'JUNK!'), 997)),
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
  cat(zlib.gzipSync('a'), 'JUNK!', zlib.gzipSync('b')),
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
for (const fmt of ['DEFLATE', 'GZIP', 'DEFLATERAW'] as const)
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

// crc32(data, value): Node's zlib.crc32 vs the binding's crc32 (lib/zlib.js passes value through).
for (const [cn, input] of Object.entries(CORPUS))
  for (const value of [0, 1, 0xffffffff, 0x12345678])
    cases.push({
      group: 'crc32',
      name: `crc32 ${cn} ${value}`,
      node: () => Buffer.from(String(zlib.crc32(input, value))),
      engine: () => Buffer.from(String(binding.crc32(input, value))),
    });

// 5. Seeded corruption fuzz.
const r = prng(42);
for (const fmt of ['DEFLATE', 'GZIP', 'DEFLATERAW'] as const) {
  const v = { DEFLATE: zlib.deflateSync, GZIP: zlib.gzipSync, DEFLATERAW: zlib.deflateRawSync }[
    fmt
  ](CORPUS.mixed300k.subarray(0, 20000));
  for (let i = 0; i < 300; i++) {
    const b = Buffer.from(v);
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) b[Math.floor(r() * b.length)] = Math.floor(r() * 256);
    oneShot('inflate-fuzz', `${inv[fmt]} fuzz ${i}`, inv[fmt], b);
  }
}

/** Group sizes of the probe's results/cases.txt. */
const GROUPS: Record<string, number> = {
  'compress-level': 264,
  'compress-strategy': 32,
  'compress-mem-window': 29,
  'compress-chunksize': 6,
  'compress-stream-flush': 22,
  'compress-params': 5,
  'compress-reset': 2,
  'compress-dictionary': 2,
  'inflate-valid': 3,
  'inflate-trailing': 18,
  'inflate-truncated': 24,
  'inflate-finishFlush': 6,
  'inflate-corrupt': 30,
  'inflate-maxOutputLength': 3,
  'inflate-chunksize': 6,
  'inflate-stream': 12,
  'gunzip-members': 5,
  'inflate-windowBits': 6,
  unzip: 5,
  'inflate-wrong-format': 3,
  'inflate-dictionary': 5,
  crc32: 32,
  'inflate-fuzz': 900,
};

describe('zlib-engine handle vs node:zlib v24.16.0 — 1420-case matrix', () => {
  it('runs on the claimed Node and carries every case of the probe', () => {
    expect(process.version).toBe('v24.16.0');
    const sizes: Record<string, number> = {};
    for (const c of cases) sizes[c.group] = (sizes[c.group] ?? 0) + 1;
    expect(sizes).toEqual(GROUPS);
    expect(cases.length).toBe(1420);
  });

  for (const group of Object.keys(GROUPS))
    it(`${group}: every case equals Node`, async () => {
      const diffs = [];
      for (const c of cases.filter((x) => x.group === group)) {
        const node = await outcome(c.node);
        const got = await outcome(c.engine);
        if (!same(got, node)) diffs.push({ case: c.name, node: show(node), engine: show(got) });
      }
      expect(diffs).toEqual([]);
    });
});
