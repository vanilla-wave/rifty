// TextDecoder source probe for the isolate guest (goal isolate-guest-web-api).
// From the repo root, after `pnpm install`:
//   node docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/probe.mjs [--timing] [--json out.json]
// Network: raw.githubusercontent.com (Node v24.16.0 sources, whatwg/encoding at a pinned commit;
// sha256-checked) and the npm registry (`npm ci` of deps/ into a temp dir).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const req = createRequire(join(root, 'packages/isolate-guest/package.json'));
const { build } = req('esbuild');
const ivm = createRequire(join(root, 'packages/isolate-host/package.json'))('isolated-vm');
const argv = process.argv.slice(2);
const timing = argv.includes('--timing');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : undefined;

// 1. Pinned inputs.
const NODE = 'https://raw.githubusercontent.com/nodejs/node/v24.16.0';
const WHATWG =
  'https://raw.githubusercontent.com/whatwg/encoding/7d2e3e08e11f57ba1b080390b490d53648c6f69c';
const PINS = {
  'encoding.js': [
    `${NODE}/lib/internal/encoding.js`,
    '569b962eccc86b00a2948e452a324f5db1c01a15ef8a9164ec11c1005819ed70',
  ],
  'single-byte.js': [
    `${NODE}/lib/internal/encoding/single-byte.js`,
    '0823a43fec61145a5f5f96d1e5ec532a1720d6ef7fe147361221ec232905859b',
  ],
  'util.js': [
    `${NODE}/lib/internal/encoding/util.js`,
    'd2b4b86ac88c150a3cd099419287381f3efffd5650de553ec0e2637eb98b9b07',
  ],
  'encodings.json': [
    `${WHATWG}/encodings.json`,
    '078212b3697f60b81225b6671bd9da2604497abff0aa8e96e4d46605c02ac9e7',
  ],
  'indexes.json': [
    `${WHATWG}/indexes.json`,
    'b7c8961095f0b4cae8f4a16a5011e7c84047a60c1277e28ee8df9e56074ee509',
  ],
};
const cache = join(tmpdir(), 'rifty-textdecoder-probe');
mkdirSync(cache, { recursive: true });
const pinned = {};
for (const [name, [url, sha]] of Object.entries(PINS)) {
  const file = join(cache, name);
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '-o', file, url]);
  const got = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (got !== sha) throw new Error(`${name}: sha256 ${got} != ${sha}`);
  pinned[name] = file;
}
const deps = join(cache, 'deps');
if (!existsSync(join(deps, 'node_modules'))) {
  cpSync(join(here, 'deps'), deps, { recursive: true });
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: deps,
    stdio: 'ignore',
  });
}
const indexes = JSON.parse(readFileSync(pinned['indexes.json'], 'utf8'));
const encodingsJson = JSON.parse(readFileSync(pinned['encodings.json'], 'utf8'));
const NAMES = encodingsJson
  .flatMap((g) => g.encodings.map((e) => e.name.toLowerCase()))
  .filter((n) => n !== 'replacement' && n !== 'utf-8');

// 2. Labels: live Node over every WHATWG label (spec: label → name; replacement → RangeError).
const labels = { total: 0, sameName: 0, differ: [] };
for (const g of encodingsJson)
  for (const e of g.encodings)
    for (const l of e.labels) {
      labels.total++;
      let got;
      try {
        got = new TextDecoder(l).encoding;
      } catch (x) {
        got = `throws ${x.constructor.name} ${x.code}`;
      }
      const want =
        e.name === 'replacement'
          ? 'throws RangeError ERR_ENCODING_NOT_SUPPORTED'
          : e.name.toLowerCase();
      if (got === want) labels.sameName++;
      else labels.differ.push([l, want, got]);
    }

// 3. Corpus tokens per decoder.
const casesSrc = readFileSync(join(here, 'cases.cjs'), 'utf8');
vm.runInThisContext(casesSrc);
const { __runCases: runCases, __describeCase: describeCase } = globalThis;
const spec = createRequire(import.meta.url)('./spec-decoder.cjs')(indexes);
class SpecTD {
  constructor(n, o = {}) {
    if (!spec.names.includes(n)) throw new RangeError(n);
    this.n = n;
    this.f = !!o.fatal;
    this.i = !!o.ignoreBOM;
    this.buf = [];
  }
  decode(u = new Uint8Array(0), o = {}) {
    this.buf.push(...u);
    if (o.stream) return '';
    const b = this.buf;
    this.buf = [];
    return spec.decode(this.n, b, this.f, this.i);
  }
}
const nodeTokens = {};
for (const n of NAMES) nodeTokens[n] = runCases(TextDecoder, n);

const show = (s) => JSON.stringify(s).replace(/\\u0001/, ' | fatal: ');
function compare(tokens, name) {
  const base = nodeTokens[name];
  let differ = 0;
  let mapping = 0; // both sides decoded without error in non-fatal mode and produced no U+FFFD, yet differ
  let refused = 0;
  let nonFatal = 0; // non-fatal output only (iconv-lite has no fatal mode)
  const examples = [];
  for (let i = 0; i < base.length; i++) {
    if (tokens[i].split('\u0001')[0] !== base[i].split('\u0001')[0]) nonFatal++;
    if (tokens[i] === base[i]) continue;
    differ++;
    if (tokens[i].startsWith('U')) refused++;
    const [a] = base[i].split('\u0001');
    const [b] = tokens[i].split('\u0001');
    if (!a.includes('�') && !b.includes('�') && !tokens[i].startsWith('U')) mapping++;
    if (examples.length < 4)
      examples.push(
        `${describeCase(name, i)
          .bytes.map((x) => x.toString(16).padStart(2, '0'))
          .join(' ')}: node ${show(base[i])} / ${show(tokens[i])}`,
      );
  }
  return { cases: base.length, differ, nonFatal, mapping, refused, examples };
}
const specVsNode = {};
for (const n of NAMES) specVsNode[n] = compare(runCases(SpecTD, n), n);

// 4. Candidates, bundled as the guest bundles (esbuild IIFE, browser) and run in a bare V8 context
// after the guest's own prelude (UTF-8 TextEncoder/TextDecoder from text-codec.ts, DOMException).
// `neutral`: @exodus/bytes's `browser` field maps its platform module to one that assumes a native
// TextDecoder with latin1 (it throws at load on the guest's UTF-8-only one); its default module
// detects a non-native TextDecoder and takes its pure-JS path.
async function bundle(contents, minify, resolveDir = deps, neutral = false) {
  const r = await build({
    stdin: { contents, resolveDir, loader: 'js' },
    bundle: true,
    format: 'iife',
    platform: neutral ? 'neutral' : 'browser',
    ...(neutral ? { mainFields: ['module', 'main'], conditions: ['default'] } : {}),
    target: 'es2022',
    minify,
    write: false,
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}
const preludeSrc = await bundle(
  `import ${JSON.stringify(join(root, 'docs/backlog/epics/isolate-guest-web-api/reference/sources-native/src/prelude.js'))};`,
  false,
  here,
);
const ICONV_TD = `
import iconv from 'iconv-lite';
import { Buffer } from 'buffer';
const NAMES = { 'gbk': 'gbk', 'gb18030': 'gb18030', 'big5': 'big5', 'euc-jp': 'euc-jp', 'shift_jis': 'shift_jis',
  'euc-kr': 'euc-kr', 'utf-16le': 'utf-16le', 'utf-16be': 'utf-16be', 'iso-2022-jp': 'iso-2022-jp' };
globalThis.__TD = class {
  constructor(label, o = {}) {
    const n = NAMES[label] ?? label;
    if (o.fatal || !iconv.encodingExists(n)) throw new RangeError('unsupported ' + label);
    this.d = iconv.getDecoder(n, { stripBOM: !o.ignoreBOM });
  }
  decode(u = new Uint8Array(0), o = {}) {
    const b = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
    return o.stream ? this.d.write(b) : this.d.write(b) + (this.d.end() ?? '');
  }
};`;
const CANDIDATES = {
  '@exodus/bytes': `import { TextDecoder } from '@exodus/bytes/encoding.js'; globalThis.__TD = TextDecoder;`,
  'text-encoding': `globalThis.__TD = require('text-encoding').TextDecoder;`,
  'iconv-lite': ICONV_TD,
};
const pkgVersion = (p) =>
  JSON.parse(readFileSync(join(deps, 'node_modules', p, 'package.json'), 'utf8')).version;
const results = {};
for (const [name, entry] of Object.entries(CANDIDATES)) {
  const neutral = name === '@exodus/bytes';
  const src = await bundle(entry, false, deps, neutral);
  const min = await bundle(entry, true, deps, neutral);
  const context = vm.createContext({});
  vm.runInContext(preludeSrc, context);
  vm.runInContext(src, context);
  vm.runInContext(casesSrc, context);
  const per = {};
  for (const n of NAMES)
    per[n] = compare(vm.runInContext(`__runCases(__TD, ${JSON.stringify(n)})`, context), n);
  results[name] = {
    version: pkgVersion(name),
    bytes: Buffer.byteLength(src),
    minBytes: Buffer.byteLength(min),
    gzipBytes: gzipSync(min).length,
    per,
    src,
  };
}

// Per-encoding table sizes in @exodus/bytes (its multi-byte JSON) and Node's own single-byte.js.
const exodusTables = JSON.parse(
  readFileSync(join(deps, 'node_modules/@exodus/bytes/fallback/multi-byte.encodings.json'), 'utf8'),
);
const tableSizes = Object.fromEntries(
  Object.entries(exodusTables).map(([k, v]) => {
    const s = JSON.stringify(v);
    return [k, { bytes: s.length, gzip: gzipSync(s).length }];
  }),
);
const nodeSingleByte = readFileSync(pinned['single-byte.js']);
const nodeSingleByteMin = await bundle(
  readFileSync(pinned['single-byte.js'], 'utf8').replace(
    /^[\s\S]*?\/\* fallback\/single-byte\.encodings\.js \*\//,
    '',
  ),
  true,
);

// 5. TextEncoder: the guest's (text-codec.ts) vs Node's.
const encContext = vm.createContext({});
vm.runInContext(preludeSrc, encContext);
const ENC_CASES = `[
  ['encoding', () => new TextEncoder().encoding],
  ['ascii', () => Array.from(new TextEncoder().encode('abc'))],
  ['lone surrogates', () => Array.from(new TextEncoder().encode('a\\ud800b\\udc00'))],
  ['astral', () => Array.from(new TextEncoder().encode('\\u{1F600}'))],
  ['undefined', () => Array.from(new TextEncoder().encode())],
  ['number', () => Array.from(new TextEncoder().encode(12))],
  ['encodeInto fits', () => { const d = new Uint8Array(8); return [new TextEncoder().encodeInto('h\\u00e9', d), Array.from(d)]; }],
  ['encodeInto short', () => { const d = new Uint8Array(2); return [new TextEncoder().encodeInto('a\\u00e9', d), Array.from(d)]; }],
  ['encodeInto astral split', () => { const d = new Uint8Array(3); return [new TextEncoder().encodeInto('\\u{1F600}', d), Array.from(d)]; }],
  ['encodeInto non-u8', () => new TextEncoder().encodeInto('a', new Uint16Array(2))],
  ['encodeInto non-string', () => new TextEncoder().encodeInto(1, new Uint8Array(2))],
].map(([n, f]) => { try { return [n, JSON.stringify(f())]; } catch (e) { return [n, 'throws ' + e.name + ' ' + (e.code ?? '')]; } })`;
const encNode = vm.runInThisContext(ENC_CASES);
const encGuest = vm.runInContext(ENC_CASES, encContext);
const textEncoder = encNode.map(([n, v], i) => ({
  case: n,
  node: v,
  guest: encGuest[i][1],
  equal: v === encGuest[i][1],
}));

// 6. Timing: a fresh isolate per call with the code cache, as packages/isolate-host/src/child/main.ts.
async function evalMs(sources, n = 40) {
  const caches = [];
  const times = [];
  for (let i = 0; i < n + 3; i++) {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < sources.length; k++) {
      const script = await isolate.compileScript(
        sources[k],
        caches[k] ? { cachedData: caches[k] } : { produceCachedData: true },
      );
      if (!caches[k]) caches[k] = script.cachedData;
      await script.run(context);
    }
    const t1 = process.hrtime.bigint();
    if (i >= 3) times.push(Number(t1 - t0) / 1e6);
    isolate.dispose();
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}
async function firstUseMs(src, label, bytes, n = 20) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = await isolate.createContext();
    await (await isolate.compileScript(preludeSrc)).run(context);
    await (await isolate.compileScript(src)).run(context);
    const code = `new __TD(${JSON.stringify(label)}).decode(new Uint8Array(${JSON.stringify(bytes)}))`;
    const t0 = process.hrtime.bigint();
    context.evalSync(code);
    const t1 = process.hrtime.bigint();
    context.evalSync(code);
    const t2 = process.hrtime.bigint();
    times.push([Number(t1 - t0) / 1e6, Number(t2 - t1) / 1e6]);
    isolate.dispose();
  }
  times.sort((a, b) => a[0] - b[0]);
  return { first: times[n >> 1][0], second: times[n >> 1][1] };
}
let timings;
if (timing) {
  timings = { loadavg: (await import('node:os')).loadavg().map((x) => x.toFixed(2)) };
  const base = await evalMs([preludeSrc]);
  timings.prelude = base;
  for (const [name, r] of Object.entries(results)) {
    timings[name] = {
      evalDeltaMs: (await evalMs([preludeSrc, r.src])) - base,
      firstUse: {
        'windows-1252': await firstUseMs(r.src, 'windows-1252', [0x68, 0xe9, 0x80]),
        'utf-16le': await firstUseMs(r.src, 'utf-16le', [0x68, 0, 0xe9, 0]),
        shift_jis: await firstUseMs(r.src, 'shift_jis', [0x82, 0xa0]),
        gb18030: await firstUseMs(r.src, 'gb18030', [0xb0, 0xa1]),
      },
    };
  }
}

// Report.
const out = {
  date: new Date().toISOString(),
  node: process.version,
  icu: process.versions.icu,
  unicode: process.versions.unicode,
  esbuild: req('esbuild/package.json').version,
  labels,
  specVsNode,
  candidates: Object.fromEntries(Object.entries(results).map(([k, { src, ...v }]) => [k, v])),
  exodusTableSizes: tableSizes,
  nodeSingleByte: {
    bytes: nodeSingleByte.length,
    tablesMinBytes: Buffer.byteLength(nodeSingleByteMin),
    tablesGzip: gzipSync(nodeSingleByteMin).length,
  },
  textEncoder,
  timings,
};
console.log(`node ${out.node} icu ${out.icu} unicode ${out.unicode}`);
console.log(
  `labels: ${labels.sameName}/${labels.total} as the spec; differ: ${JSON.stringify(labels.differ)}`,
);
const row = (n, cols) =>
  console.log([n.padEnd(15), ...cols.map((c) => String(c).padStart(26))].join(' '));
row('encoding', ['spec vs node', ...Object.keys(results)]);
for (const n of NAMES)
  row(
    n,
    [specVsNode[n], ...Object.values(results).map((r) => r.per[n])].map((c) =>
      c.refused === c.cases ? 'refused' : `${c.differ}/${c.cases} nf ${c.nonFatal} m ${c.mapping}`,
    ),
  );
for (const n of NAMES) for (const e of specVsNode[n].examples) console.log(`  spec ${n} ${e}`);
for (const [k, r] of Object.entries(results))
  console.log(`${k} ${r.version}: ${r.bytes} B, min ${r.minBytes} B, gzip ${r.gzipBytes} B`);
console.log(
  `Node single-byte.js ${out.nodeSingleByte.bytes} B (tables min ${out.nodeSingleByte.tablesMinBytes}, gzip ${out.nodeSingleByte.tablesGzip})`,
);
console.log(`exodus multi-byte tables: ${JSON.stringify(tableSizes)}`);
console.log(
  `TextEncoder guest vs node: ${
    textEncoder
      .filter((c) => !c.equal)
      .map((c) => `${c.case}: node ${c.node} guest ${c.guest}`)
      .join('; ') || 'all equal'
  }`,
);
if (timings) console.log(`timing: ${JSON.stringify(timings)}`);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(out, null, 1)}\n`);
