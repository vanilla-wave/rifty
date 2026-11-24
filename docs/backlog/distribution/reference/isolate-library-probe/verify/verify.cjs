// node verify.cjs <pptx|pdf|docx|xlsx> <file> → JSON verdict on stdout, in real Node. OOXML readers
// are not the generating library; a PDF is checked by pdf-lib itself (as the requirement names it),
// so a valid PDF means pdf-lib parses it.
// OOXML: a ZIP, the expected parts present, every XML part well-formed, then a reader:
// xlsx SheetJS, docx mammoth, pptx the slide list + slide text (no maintained Node pptx reader;
// verify.py cross-checks with python-pptx / python-docx / openpyxl).
const { readFileSync } = require('node:fs');
const JSZip = require('jszip');
const { XMLValidator } = require('fast-xml-parser');

const [kind, file] = process.argv.slice(2);
const bytes = readFileSync(file);
const fail = (why) => {
  console.log(JSON.stringify({ ok: false, why }));
  process.exit(0);
};
const EXPECT = {
  pptx: [
    '[Content_Types].xml',
    '_rels/.rels',
    'ppt/presentation.xml',
    'ppt/slides/slide1.xml',
    'ppt/slides/slide2.xml',
    'ppt/slides/slide3.xml',
    /^ppt\/charts\/chart\d+\.xml$/,
    /^ppt\/media\/.+\.png$/,
  ],
  docx: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', /^word\/media\/.+\.png$/],
  xlsx: [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
    /^xl\/media\/.+\.png$/,
  ],
};

// `node verify.cjs diff <a> <b>`: node's output against the guest's, timestamps masked — the ZIP
// entries that differ (a snippet around the first difference) or, for a PDF, the first difference.
const mask = (t) =>
  t
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>')
    .replace(/D:\d{14}Z?(\d\d'\d\d'?)?/g, '<time>')
    .replace(/\/ID \[ <[0-9A-F]+> <[0-9A-F]+> \]/g, '/ID <id>');
const first = (tx, ty) => {
  let i = 0;
  while (tx[i] === ty[i]) i++;
  return {
    node: tx.slice(Math.max(0, i - 30), i + 40),
    guest: ty.slice(Math.max(0, i - 30), i + 40),
  };
};
const diff = async (a, b) => diffBytes(readFileSync(a), readFileSync(b));
const diffBytes = async (x, y) => {
  if (x.readUInt32LE(0) !== 0x04034b50) {
    // A PDF: its Flate streams inflated, so a difference shows as text.
    const { inflateSync } = require('node:zlib');
    // Timestamps change compressed lengths and offsets: those are masked after inflating.
    const text = (buf) =>
      mask(
        buf.toString('latin1').replace(/stream\r?\n([\s\S]*?)endstream/g, (all, body) => {
          try {
            return `stream[${inflateSync(Buffer.from(body, 'latin1')).toString('latin1')}]`;
          } catch {
            return all;
          }
        }),
      )
        .replace(/\/Length \d+/g, '/Length <n>')
        .replace(/startxref\s+\d+/g, 'startxref <n>');
    const [tx, ty] = [text(x), text(y)];
    return tx === ty ? { equal: true } : { equal: false, ...first(tx, ty) };
  }
  const [zx, zy] = await Promise.all([JSZip.loadAsync(x), JSZip.loadAsync(y)]);
  const entries = (z) => Object.keys(z.files).filter((n) => !z.files[n].dir);
  const names = [...new Set([...entries(zx), ...entries(zy)])].sort();
  const parts = [];
  for (const n of names) {
    const [px, py] = [zx.file(n), zy.file(n)];
    if (!px || !py) parts.push({ part: n, only: px ? 'node' : 'guest' });
    else {
      if (/\.(xlsx|docx|pptx|zip)$/.test(n)) {
        // A nested package (pptx chart data): diffed as its own entries.
        const inner = await diffBytes(await px.async('nodebuffer'), await py.async('nodebuffer'));
        if (!inner.equal) parts.push({ part: n, inner: inner.parts });
        continue;
      }
      if (!/\.(xml|rels|vml)$/.test(n)) {
        // Binary parts (media): bytes, unmasked.
        const [bx, by] = await Promise.all([px.async('nodebuffer'), py.async('nodebuffer')]);
        if (!bx.equals(by)) parts.push({ part: n, bytes: [bx.length, by.length] });
        continue;
      }
      const [tx, ty] = (await Promise.all([px.async('string'), py.async('string')])).map(mask);
      if (tx !== ty) parts.push({ part: n, ...first(tx, ty) });
    }
  }
  return { equal: parts.length === 0, parts };
};

(async () => {
  if (kind === 'diff') return diff(file, process.argv[4]);
  if (kind === 'pdf') {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPageCount();
    const title = doc.getTitle();
    if (pages !== 2 || title !== 'Probe PDF') fail(`pages ${pages}, title ${title}`);
    return { pages, title };
  }
  if (bytes.readUInt32LE(0) !== 0x04034b50) fail('not a ZIP (no local file header)');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  for (const want of EXPECT[kind]) {
    if (!names.some((n) => (typeof want === 'string' ? n === want : want.test(n))))
      fail(`missing part ${want}`);
  }
  for (const n of names.filter((n) => /\.(xml|rels)$/.test(n))) {
    const v = XMLValidator.validate(await zip.file(n).async('string'));
    if (v !== true) fail(`${n}: ${v.err.msg}`);
  }
  if (kind === 'xlsx') {
    const XLSX = require('xlsx');
    const wb = XLSX.read(bytes, { type: 'buffer', cellFormula: true });
    const ws = wb.Sheets.Revenue;
    if (!ws) fail(`sheets ${wb.SheetNames}`);
    const got = { A1: ws.A1?.v, B2: ws.B2?.v, B4f: ws.B4?.f, B4: ws.B4?.v };
    if (got.A1 !== 'Region' || got.B2 !== 120 || got.B4f !== 'SUM(B2:B3)' || got.B4 !== 215)
      fail(`cells ${JSON.stringify(got)}`);
    return { parts: names.length, ...got };
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    for (const t of ['Quarterly report', 'Revenue grew 12%', 'North'])
      if (!value.includes(t)) fail(`text lacks ${t}`);
    return { parts: names.length, text: value.replace(/\s+/g, ' ').trim().slice(0, 80) };
  }
  if (kind === 'pptx') {
    const pres = await zip.file('ppt/presentation.xml').async('string');
    const slides = (pres.match(/<p:sldId /g) || []).length;
    const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
    if (slides !== 3 || !s1.includes('Quarterly report')) fail(`slides ${slides}`);
    return { parts: names.length, slides };
  }
  fail(`unknown kind ${kind}`);
})().then(
  (detail) => console.log(JSON.stringify({ ok: true, ...detail })),
  (e) => fail(String(e?.message)),
);
