import { execFileSync } from 'node:child_process';
// Measures the TextDecoder variant guest (build.mjs) against the base guest and live Node.
//   node docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/bundle/run.mjs [--variant td-lazy-fast] [--timing] [--utf8] [--n 40]
// Writes results.json / results.txt beside this file (--timing: results-timing.json only; --utf8:
// results-utf8.json only). Exit 1 when any in-set encoding differs or its guest run did not finish.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../../..');
const host = join(root, 'packages/isolate-host');
const variantDir = (v) => join(host, 'node_modules/.web-api-probe', v, 'dist');
const load = async (dir) => import(pathToFileURL(join(dir, 'index.js')).href);
const argv = process.argv.slice(2);
const timing = argv.includes('--timing');
const N = argv.includes('--n') ? Number(argv[argv.indexOf('--n') + 1]) : 40;

const base = await load(join(host, 'dist'));
const VARIANT = argv.includes('--variant') ? argv[argv.indexOf('--variant') + 1] : 'td-lazy-fast';
const td = await load(variantDir(VARIANT));
const tdNone = await load(variantDir('td-none'));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

const UTF8_CODE = `const small = Buffer.from('hello world, привет'); const big = Buffer.alloc(1 << 20, 97);
const d = new TextDecoder(); const r = {};
let t = performance.now(); let n = 0;
for (let i = 0; i < 20000; i++) n += new TextDecoder().decode(small).length; r.freshDecoderSmall = performance.now() - t;
t = performance.now(); for (let i = 0; i < 20000; i++) n += d.decode(small).length; r.reusedDecoderSmall = performance.now() - t;
t = performance.now(); for (let i = 0; i < 20000; i++) n += small.toString().length; r.bufferToStringSmall = performance.now() - t;
t = performance.now(); for (let i = 0; i < 20; i++) n += d.decode(big).length; r.decode1MiBx20 = performance.now() - t;
t = performance.now(); for (let i = 0; i < 20; i++) n += big.toString().length; r.bufferToString1MiBx20 = performance.now() - t;
console.log(JSON.stringify(r));`;
if (argv.includes('--utf8')) {
  const vs = {
    base,
    'td-gb': await load(variantDir('td-gb')),
    'td-lazy': await load(variantDir('td-lazy')),
    'td-lazy-fast': await load(variantDir('td-lazy-fast')),
  };
  const runs = Object.fromEntries(Object.keys(vs).map((k) => [k, []]));
  for (const m of Object.values(vs)) await m.runCode(UTF8_CODE);
  const la0 = loadavg();
  for (let i = 0; i < 9; i++)
    for (const [k, m] of Object.entries(vs))
      runs[k].push(JSON.parse((await m.runCode(UTF8_CODE, { timeoutMs: 120_000 })).stdout));
  const keys = Object.keys(runs.base[0]);
  const med = {};
  for (const [k, rs] of Object.entries(runs))
    med[k] = Object.fromEntries(
      keys.map((x) => [x, Number(median(rs.map((r) => r[x])).toFixed(2))]),
    );
  const spread = {};
  for (const [k, rs] of Object.entries(runs))
    spread[k] = Object.fromEntries(
      keys.map((x) => {
        const a = rs.map((r) => r[x]).sort((p, q) => p - q);
        return [x, [Number(a[1].toFixed(2)), Number(a[a.length - 2].toFixed(2))]];
      }),
    );
  const res = {
    runs: 9,
    loadavgBefore: la0,
    loadavgAfter: loadavg(),
    medianMs: med,
    p10p90Ms: spread,
  };
  writeFileSync(join(here, 'results-utf8.json'), `${JSON.stringify(res, null, 2)}\n`);
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

if (timing) {
  const vs = {
    base,
    'td-gb': await load(variantDir('td-gb')),
    'td-lazy': await load(variantDir('td-lazy')),
    'td-lazy-fast': await load(variantDir('td-lazy-fast')),
    'td-none': tdNone,
  };
  const t = Object.fromEntries(Object.keys(vs).map((k) => [k, []]));
  for (let i = 0; i < 5; i++) for (const m of Object.values(vs)) await m.runCode('1');
  const la0 = loadavg();
  for (let i = 0; i < N; i++) {
    for (const [k, m] of Object.entries(vs)) {
      const s = performance.now();
      await m.runCode('1');
      t[k].push(performance.now() - s);
    }
  }
  const firstUse = {};
  for (const [label, bytes] of [
    ['windows-1252', '[0x68,0x69,0xe9,0x80]'],
    ['utf-16le', '[0x68,0,0x69,0,0x3d,0xd8,0x00,0xde]'],
    ['gb18030', '[0x81,0x30,0x81,0x30,0xb0,0xa1,0x41]'],
  ]) {
    const runs = [];
    for (let i = 0; i < 10; i++) {
      const r = await td.runCode(
        `const b=new Uint8Array(${bytes});let t=performance.now();new TextDecoder('${label}').decode(b);const first=performance.now()-t;t=performance.now();new TextDecoder('${label}').decode(b);console.log(JSON.stringify([first,performance.now()-t]))`,
      );
      runs.push(JSON.parse(r.stdout));
    }
    firstUse[label] = {
      firstMs: median(runs.map((r) => r[0])),
      secondMs: median(runs.map((r) => r[1])),
    };
  }
  const res = {
    n: N,
    loadavgBefore: la0,
    loadavgAfter: loadavg(),
    medianMs: Object.fromEntries(
      Object.entries(t).map(([k, a]) => [k, Number(median(a).toFixed(2))]),
    ),
    p10p90Ms: Object.fromEntries(
      Object.entries(t).map(([k, a]) => {
        const s = [...a].sort((x, y) => x - y);
        return [
          k,
          [
            Number(s[Math.floor(s.length * 0.1)].toFixed(2)),
            Number(s[Math.floor(s.length * 0.9)].toFixed(2)),
          ],
        ];
      }),
    ),
    firstUseVariant: VARIANT,
    firstUseInGuest: firstUse,
  };
  writeFileSync(join(here, 'results-timing.json'), `${JSON.stringify(res, null, 2)}\n`);
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};
const results = {};

// 1. Corpus (../cases.cjs) per encoding: per-case FNV-1a hash of the token, guest vs Node.
const casesSrc = readFileSync(join(here, '../cases.cjs'), 'utf8');
vm.runInThisContext(casesSrc);
const fnv = `const __fnv=(s)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h.toString(16).padStart(8,'0')};`;
vm.runInThisContext(fnv.replace('const __fnv', 'globalThis.__fnv'));
const NAMES = [
  'utf-8',
  'ibm866',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-8-i',
  'iso-8859-10',
  'iso-8859-13',
  'iso-8859-14',
  'iso-8859-15',
  'iso-8859-16',
  'koi8-r',
  'koi8-u',
  'macintosh',
  'windows-874',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'x-mac-cyrillic',
  'gbk',
  'gb18030',
  'big5',
  'euc-jp',
  'iso-2022-jp',
  'shift_jis',
  'euc-kr',
  'utf-16be',
  'utf-16le',
  'x-user-defined',
];
const ICU_ONLY = new Set(['big5', 'euc-jp', 'iso-2022-jp', 'shift_jis', 'euc-kr']);
results.corpus = {};
let totalDiff = 0;
let unfinished = 0;
for (const name of NAMES) {
  const nodeH = globalThis.__runCases(TextDecoder, name).map(globalThis.__fnv);
  const r = await td.runCode(
    `${casesSrc}\n${fnv}\nprocess.stdout.write(__runCases(TextDecoder, ${JSON.stringify(name)}).map(__fnv).join(''))`,
    { timeoutMs: 300_000, maxOutputBytes: 16 << 20, memoryLimitMb: 512 },
  );
  if (r.exitCode !== 0) {
    // In the set, a run that did not finish counts as every case differing; an ICU-only encoding
    // must refuse with its named gap, anything else is a failure too.
    const named = r.stderr.includes(`isolate-host.TextDecoder(${name})`);
    const ok = ICU_ONLY.has(name) && named;
    if (!ok) {
      unfinished++;
      if (!ICU_ONLY.has(name)) totalDiff += nodeH.length;
    }
    results.corpus[name] = {
      error: r.stderr.slice(0, 400),
      exitCode: r.exitCode,
      termination: r.termination,
      ...(ok ? { refused: 'named gap' } : { unfinished: true, differ: nodeH.length }),
    };
    log(
      `corpus ${name}: guest exit ${r.exitCode} ${r.termination ?? ''} ${ok ? '(ICU-only: the named gap, as designed)' : 'UNFINISHED, counted as differing'} ${r.stderr.split('\n')[0].slice(0, 160)}`,
    );
    continue;
  }
  const g = r.stdout.match(/.{8}/g) ?? [];
  let diff = 0;
  const ex = [];
  for (let i = 0; i < nodeH.length; i++)
    if (g[i] !== nodeH[i]) {
      diff++;
      if (ex.length < 2) ex.push(globalThis.__describeCase(name, i));
    }
  if (!ICU_ONLY.has(name)) totalDiff += diff;
  results.corpus[name] = { cases: nodeH.length, differ: diff, examples: ex };
  log(
    `corpus ${name}: ${diff}/${nodeH.length} differ${ICU_ONLY.has(name) ? ' (ICU-only: guest refuses at construction)' : ''}`,
  );
}
log(
  `corpus total over the 33 in-set encodings: ${totalDiff} differ, ${unfinished} unfinished runs`,
);

// 2. Labels (WHATWG encodings.json, pinned in ../probe.mjs's cache) and error/identity cases.
const encJson = join(tmpdir(), 'rifty-textdecoder-probe/encodings.json');
if (!existsSync(encJson)) throw new Error('run ../probe.mjs once first (it pins encodings.json)');
const labels = JSON.parse(readFileSync(encJson, 'utf8')).flatMap((g) =>
  g.encodings.flatMap((e) => e.labels),
);
const probeSrc = `(() => {
  const d = (f) => { try { const v = f(); return typeof v === 'string' ? 'S:' + v : 'V:' + JSON.stringify(v); } catch (e) { return 'E:' + (e && e.constructor && e.constructor.name) + '|' + (e && e.code) + '|' + (e && e.message); } };
  const util = require('util');
  const out = {};
  for (const l of ${JSON.stringify(labels)}) out['label ' + l] = d(() => new TextDecoder(l).encoding);
  Object.assign(out, {
    "new TextDecoder('nope')": d(() => new TextDecoder('nope')),
    "new TextDecoder(' UTF-8 ').encoding": d(() => new TextDecoder(' UTF-8 ').encoding),
    "new TextDecoder('utf-8', 1)": d(() => new TextDecoder('utf-8', 1)),
    "utf-8 fatal [ff]": d(() => new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xff]))),
    "utf-16le fatal [00 d8]": d(() => new TextDecoder('utf-16le', { fatal: true }).decode(new Uint8Array([0, 0xd8]))),
    "gb18030 fatal [81]": d(() => new TextDecoder('gb18030', { fatal: true }).decode(new Uint8Array([0x81]))),
    "windows-1253 fatal [aa]": d(() => new TextDecoder('windows-1253', { fatal: true }).decode(new Uint8Array([0xaa]))),
    "decode('x')": d(() => new TextDecoder().decode('x')),
    "decode(1)": d(() => new TextDecoder().decode(1)),
    "utf-16le decode('x')": d(() => new TextDecoder('utf-16le').decode('x')),
    "decode.call({})": d(() => TextDecoder.prototype.decode.call({})),
    "encoding getter on {}": d(() => Object.getOwnPropertyDescriptor(TextDecoder.prototype, 'encoding').get.call({})),
    "fatal/ignoreBOM getters": d(() => { const x = new TextDecoder('utf-16be', { fatal: 1, ignoreBOM: 'y' }); return [x.encoding, x.fatal, x.ignoreBOM]; }),
    "toString tag": d(() => Object.prototype.toString.call(new TextDecoder()) + Object.prototype.toString.call(new TextEncoder())),
    "util.TextDecoder === TextDecoder": d(() => util.TextDecoder === TextDecoder),
    "util.TextEncoder === TextEncoder": d(() => util.TextEncoder === TextEncoder),
    "encodeInto non-u8 dest": d(() => new TextEncoder().encodeInto('a', {})),
    "encodeInto non-string src": d(() => new TextEncoder().encodeInto(1, new Uint8Array(4))),
    "encodeInto ok": d(() => { const u = new Uint8Array(3); return [new TextEncoder().encodeInto('aé€', u), [...u]]; }),
    "encode()": d(() => [...new TextEncoder().encode()]),
    "encode lone surrogate": d(() => [...new TextEncoder().encode('\\ud800')]),
    "Buffer.toString utf8 (runtime through the global)": d(() => Buffer.from([0xe2, 0x82, 0xac, 0xff]).toString()),
    "stream utf-8 split €": d(() => { const x = new TextDecoder(); return x.decode(new Uint8Array([0xe2, 0x82]), { stream: true }) + x.decode(new Uint8Array([0xac])); }),
  });
  return out;
})()`;
const nodeOut = vm.runInThisContext(
  probeSrc.replace("require('util')", "process.getBuiltinModule('util')"),
);
const gr = await td.runCode(`process.stdout.write(JSON.stringify(${probeSrc}))`, {
  maxOutputBytes: 4 << 20,
});
const guestOut = JSON.parse(gr.stdout || '{}');
if (gr.exitCode !== 0) log(`labels/errors guest exit ${gr.exitCode}: ${gr.stderr.slice(0, 300)}`);
const lab = { total: 0, same: 0, differ: [] };
const errs = {};
for (const [k, v] of Object.entries(nodeOut)) {
  const same = guestOut[k] === v;
  if (k.startsWith('label ')) {
    lab.total++;
    if (same) lab.same++;
    else lab.differ.push({ label: k.slice(6), node: v, guest: guestOut[k] });
  } else errs[k] = { node: v, guest: guestOut[k], same };
}
results.labels = lab;
results.cases = errs;
log(
  `labels: ${lab.same}/${lab.total} equal Node; differ: ${lab.differ
    .map((d) => `${d.label} (node ${d.node} | guest ${d.guest})`)
    .join('; ')
    .slice(0, 1500)}`,
);
for (const [k, v] of Object.entries(errs))
  log(`${v.same ? '=' : '≠'} ${k}: node ${v.node}${v.same ? '' : ` | guest ${v.guest}`}`);

// 3. pdfkit 0.17.2 (Helvetica, compress: false) in a sandbox over its closure vs live node.
const { closureFiles, inNode } = await import(
  pathToFileURL(join(host, 'tests/closure-files.ts')).href
);
const pdfkitDir = execFileSync(
  'node',
  ['-p', "require('path').dirname(require.resolve('pdfkit/package.json'))"],
  { cwd: host, encoding: 'utf8' },
).trim();
const files = closureFiles('pdfkit', pdfkitDir);
const gen = `const PDFDocument = require('pdfkit');
const fs = require('fs');
const doc = new PDFDocument({ compress: false, info: { CreationDate: new Date(0) } });
const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => { fs.writeFileSync(process.argv[2], Buffer.concat(chunks)); console.log('bytes', Buffer.concat(chunks).length); });
doc.font('Helvetica').fontSize(14).text('Hello from pdfkit — é ü', 72, 72);
doc.end();
`;
files.set('gen.js', new TextEncoder().encode(gen));
const node = inNode(files, 'gen.js', 'out.pdf');
const codec = await import(pathToFileURL(join(variantDir(VARIANT), 'codec.js')).href);
const pdfIn = async (m) => {
  const fs = new codec.MemoryFsSync();
  for (const dir of codec.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  for (const [rel, data] of files) {
    const p = `/workspace/${rel}`;
    fs.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(p, data);
  }
  const maxFsBytes = 256 * 2 ** 20;
  const sb = await m.createSandbox({
    snapshot: codec.snapshotFs(fs, { template: null, maxBytes: maxFsBytes }),
    maxFsBytes,
  });
  try {
    const r = await sb.exec('gen.js', { args: ['out.pdf'], timeoutMs: 60_000, memoryLimitMb: 512 });
    let file;
    try {
      file = await sb.readFile('out.pdf');
    } catch {}
    return {
      stdout: r.stdout,
      stderr: r.stderr.split('\n').slice(0, 3).join('\n'),
      exitCode: r.exitCode,
      sha: file && createHash('sha256').update(file).digest('hex'),
    };
  } finally {
    await sb.destroy();
  }
};
const nodeSha = node.file && createHash('sha256').update(node.file).digest('hex');
results.pdfkit = {
  node: { stdout: node.stdout, exitCode: node.exitCode, sha: nodeSha },
  base: await pdfIn(base),
  [VARIANT]: await pdfIn(td),
};
for (const [k, v] of Object.entries(results.pdfkit))
  log(
    `pdfkit ${k}: exit ${v.exitCode} ${v.stdout.trim()} ${v.stderr ? v.stderr.split('\n')[0] : ''} sha ${v.sha?.slice(0, 16)}`,
  );

results.meta = {
  variant: VARIANT,
  date: '2026-11-25',
  node: process.version,
  head: execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
};
writeFileSync(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(join(here, 'results.txt'), `${lines.join('\n')}\n`);
const labelsOk = lab.differ.every((d) =>
  /isolate-host\.TextDecoder\((big5|euc-jp|iso-2022-jp|shift_jis|euc-kr)\)/.test(d.guest ?? ''),
);
const casesOk = Object.values(errs).every((v) => v.same);
const pdfOk = results.pdfkit[VARIANT].sha === nodeSha && results.pdfkit[VARIANT].exitCode === 0;
if (totalDiff || unfinished || !labelsOk || !casesOk || !pdfOk) {
  console.error(
    `FAIL: corpus ${totalDiff} differ, ${unfinished} unfinished, labels ${labelsOk}, cases ${casesOk}, pdfkit ${pdfOk}`,
  );
  process.exit(1);
}
