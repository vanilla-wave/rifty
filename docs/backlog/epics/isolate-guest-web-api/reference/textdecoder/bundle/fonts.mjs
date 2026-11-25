// pdfkit/fontkit and TextDecoder labels: which labels fontkit asks for, a TTF case and a CJK
// name-table case, live Node vs the isolate guest (base dist and a variant from build.mjs).
//   node docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/bundle/fonts.mjs [--variant td-lazy-fast]
// Network: the npm registry (`npm ci` of fonts/, DejaVu 2.37.3 — Bitstream Vera / public-domain
// changes). Writes results-fonts.json / results-fonts.txt beside this file.
//
// The CJK font is synthetic: DejaVuSans.ttf with Mac-platform `name` records added for the family
// name (nameID 1) in Japanese (encodingID 1 → fontkit 'shift-jis'), Traditional Chinese (2 → big5),
// Korean (3 → euc-kr) and Simplified Chinese (25 → gbk) — the records Apple's CJK system fonts
// carry (Hiragino, AppleGothic, Songti; not redistributable). Only the `name` table changes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../../..');
const host = join(root, 'packages/isolate-host');
const argv = process.argv.slice(2);
const VARIANT = argv.includes('--variant') ? argv[argv.indexOf('--variant') + 1] : 'td-lazy-fast';
const variantDir = (v) => join(host, 'node_modules/.web-api-probe', v, 'dist');
const load = async (dir) => import(pathToFileURL(join(dir, 'index.js')).href);
const base = await load(join(host, 'dist'));
const td = await load(variantDir(VARIANT));
const sha = (b) => b && createHash('sha256').update(b).digest('hex');

// 1. DejaVu from npm.
const work = join(tmpdir(), 'rifty-textdecoder-fonts-probe');
if (!existsSync(join(work, 'node_modules/dejavu-fonts-ttf'))) {
  mkdirSync(work, { recursive: true });
  cpSync(join(here, 'fonts/package.json'), join(work, 'package.json'));
  cpSync(join(here, 'fonts/package-lock.json'), join(work, 'package-lock.json'));
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: work,
    stdio: 'ignore',
  });
}
const dejavu = readFileSync(join(work, 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf'));

// 2. The synthetic CJK name records (an sfnt rebuild with a new `name` table).
const CJK = [
  // [encodingID, languageID, family name bytes in that Mac encoding]
  [1, 11, [0x83, 0x65, 0x83, 0x58, 0x83, 0x67]], // Japanese, shift_jis «テスト»
  [2, 19, [0xb4, 0xfa, 0xb8, 0xd5]], // Traditional Chinese, big5 «測試»
  [3, 23, [0xb0, 0xa1, 0xb3, 0xaa]], // Korean, euc-kr «가나»
  [25, 33, [0xb2, 0xe2, 0xca, 0xd4]], // Simplified Chinese, gbk «测试»
];
function withCjkNames(font) {
  const numTables = font.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.push({
      tag: font.toString('latin1', o, o + 4),
      offset: font.readUInt32BE(o + 8),
      length: font.readUInt32BE(o + 12),
    });
  }
  const data = Object.fromEntries(
    tables.map((t) => [t.tag, font.subarray(t.offset, t.offset + t.length)]),
  );
  const name = data.name;
  const count = name.readUInt16BE(2);
  const storageOff = name.readUInt16BE(4);
  const records = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const len = name.readUInt16BE(o + 8);
    const off = name.readUInt16BE(o + 10);
    records.push({
      p: name.readUInt16BE(o),
      e: name.readUInt16BE(o + 2),
      l: name.readUInt16BE(o + 4),
      n: name.readUInt16BE(o + 6),
      bytes: name.subarray(storageOff + off, storageOff + off + len),
    });
  }
  for (const [e, l, bytes] of CJK) records.push({ p: 1, e, l, n: 1, bytes: Buffer.from(bytes) });
  records.sort((a, b) => a.p - b.p || a.e - b.e || a.l - b.l || a.n - b.n);
  const header = Buffer.alloc(6 + records.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(records.length, 2);
  header.writeUInt16BE(header.length, 4);
  const storage = [];
  let at = 0;
  records.forEach((r, i) => {
    const o = 6 + i * 12;
    header.writeUInt16BE(r.p, o);
    header.writeUInt16BE(r.e, o + 2);
    header.writeUInt16BE(r.l, o + 4);
    header.writeUInt16BE(r.n, o + 6);
    header.writeUInt16BE(r.bytes.length, o + 8);
    header.writeUInt16BE(at, o + 10);
    storage.push(r.bytes);
    at += r.bytes.length;
  });
  data.name = Buffer.concat([header, ...storage]);
  const tags = tables.map((t) => t.tag).sort();
  const dir = Buffer.alloc(12 + tags.length * 16);
  font.copy(dir, 0, 0, 12);
  const bodies = [];
  let off = dir.length;
  const checksum = (b) => {
    const p = Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
    let s = 0;
    for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
    return s;
  };
  tags.forEach((tag, i) => {
    const b = data[tag];
    const o = 12 + i * 16;
    dir.write(tag, o, 'latin1');
    dir.writeUInt32BE(checksum(b), o + 4);
    dir.writeUInt32BE(off, o + 8);
    dir.writeUInt32BE(b.length, o + 12);
    const padded = Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
    bodies.push(padded);
    off += padded.length;
  });
  return Buffer.concat([dir, ...bodies]);
}
const cjkFont = withCjkNames(dejavu);

// 3. Programs (each runs in live node and in the guest over pdfkit's closure + the fonts).
const TRACE = `const __labels = new Set(); { const TD = globalThis.TextDecoder;
  globalThis.TextDecoder = class TextDecoder extends TD { constructor(l = 'utf-8', o) { __labels.add(String(l)); super(l, o); } }; }`;
const PDF = (font) => `const PDFDocument = require('pdfkit'); const fs = require('fs');
const doc = new PDFDocument({ compress: false, info: { CreationDate: new Date(0) } });
const chunks = []; doc.on('data', (c) => chunks.push(c));
doc.on('end', () => { fs.writeFileSync(process.argv[2], Buffer.concat(chunks)); console.log('labels', JSON.stringify([...__labels].sort()), 'bytes', Buffer.concat(chunks).length); });
doc.font(${font}).fontSize(14).text('Hello from pdfkit — é ü', 72, 72); doc.end();`;
const programs = {
  'helvetica.js': `${TRACE}\n${PDF("'Helvetica'")}`,
  'ttf.js': `${TRACE}\n${PDF("'fonts/DejaVuSans.ttf'")}`,
  'cjk-pdf.js': `${TRACE}\n${PDF("'fonts/DejaVuSans-cjk-names.ttf'")}`,
  // The observable of the five ICU-only encodings: the family names fontkit reads from `name`.
  'cjk-names.js': `const fontkit = require(require.resolve('fontkit', { paths: [require('path').dirname(require.resolve('pdfkit'))] }));
const f = fontkit.openSync('fonts/DejaVuSans-cjk-names.ttf');
const fam = f.name.records.fontFamily;
const show = (v) => (typeof v === 'string' ? v : 'BYTES ' + v.length);
console.log(JSON.stringify(Object.fromEntries(Object.keys(fam).sort().map((k) => [k, show(fam[k])]))));`,
};

const { closureFiles, inNode } = await import(
  pathToFileURL(join(host, 'tests/closure-files.ts')).href
);
const pdfkitDir = execFileSync(
  'node',
  ['-p', "require('path').dirname(require.resolve('pdfkit/package.json'))"],
  {
    cwd: host,
    encoding: 'utf8',
  },
).trim();
const files = closureFiles('pdfkit', pdfkitDir);
files.set('fonts/DejaVuSans.ttf', new Uint8Array(dejavu));
files.set('fonts/DejaVuSans-cjk-names.ttf', new Uint8Array(cjkFont));
for (const [name, src] of Object.entries(programs)) files.set(name, new TextEncoder().encode(src));
const codec = await import(pathToFileURL(join(variantDir(VARIANT), 'codec.js')).href);
const inGuest = async (m, entry) => {
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
    const r = await sb.exec(entry, { args: ['out.pdf'], timeoutMs: 60_000, memoryLimitMb: 512 });
    let file;
    try {
      file = await sb.readFile('out.pdf');
    } catch {}
    return {
      stdout: r.stdout.trim(),
      stderr: r.stderr.split('\n')[0],
      exitCode: r.exitCode,
      sha: sha(file),
    };
  } finally {
    await sb.destroy();
  }
};
const results = {
  variant: VARIANT,
  node: process.version,
  fonts: { dejavu: sha(dejavu), cjk: sha(cjkFont) },
};
const lines = [];
for (const entry of Object.keys(programs)) {
  const n = inNode(files, entry, 'out.pdf');
  const row = {
    node: { stdout: n.stdout.trim(), exitCode: n.exitCode, sha: sha(n.file) },
    base: await inGuest(base, entry),
    [VARIANT]: await inGuest(td, entry),
  };
  results[entry] = row;
  for (const [k, v] of Object.entries(row))
    lines.push(
      `${entry} ${k}: exit ${v.exitCode} ${v.stdout} ${v.stderr ?? ''} ${v.sha ? `sha ${v.sha.slice(0, 16)}` : ''}`.trim(),
    );
}
writeFileSync(join(here, 'results-fonts.json'), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(join(here, 'results-fonts.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
