// Host-side fixture builder (real Node): node make-pdfs.cjs <outDir>
// Resolves pdf-lib / fontkit / pdfkit / DejaVu from ../gen-deps/node_modules.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createRequire } = require('node:module');
const req = createRequire(path.join(__dirname, '../gen-deps/package.json'));
const { PDFDocument, StandardFonts } = req('pdf-lib');
const fontkit = req('@pdf-lib/fontkit');
const PDFKit = req('pdfkit');
const out = process.argv[2];
const dejavu = path.join(
  path.dirname(req.resolve('dejavu-fonts-ttf/package.json')),
  'ttf/DejaVuSans.ttf',
);

// 1. latin-raw.pdf: hand-written, one page, uncompressed content stream, classic xref table,
// standard Helvetica (not embedded). No inflate needed to read it.
function latinRaw() {
  const content =
    'BT /F1 18 Tf 72 720 Td (Hello rifty PDF text) Tj ET\n' +
    'BT /F1 12 Tf 72 690 Td (Second line: The quick brown fox jumps over the lazy dog.) Tj ET\n' +
    'BT /F1 12 Tf 72 670 Td (Numbers 0123456789 and symbols \\(a+b\\) = c.) Tj ET\n';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(path.join(out, 'latin-raw.pdf'), Buffer.from(pdf, 'latin1'));
}

// 2. multi-flate.pdf: pdf-lib, 3 pages, Flate content streams, object streams + xref stream.
async function multiFlate() {
  const doc = await PDFDocument.create();
  doc.setTitle('rifty multi-page probe');
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  for (let p = 1; p <= 3; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${p} of 3: heading`, { x: 50, y: 780, size: 20, font: helv });
    for (let l = 1; l <= 12; l++)
      page.drawText(
        `p${p} line ${l}: lorem ipsum dolor sit amet, consectetur adipiscing elit ${p * 100 + l}.`,
        {
          x: 50,
          y: 780 - l * 22,
          size: 11,
          font: l % 2 ? times : helv,
        },
      );
  }
  fs.writeFileSync(path.join(out, 'multi-flate.pdf'), await doc.save({ useObjectStreams: true }));
}

// 3. cyrillic.pdf: pdf-lib + fontkit, DejaVu Sans subset (Type0 / Identity-H / ToUnicode), 2 pages.
async function cyrillic() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(dejavu), { subset: true });
  const lines = [
    [
      'Привет, мир! Это проверка извлечения текста.',
      'Съешь же ещё этих мягких французских булок, да выпей чаю.',
      'Смешанная строка: rifty isolate № 42 — «кавычки», ёЁ.',
    ],
    [
      'Вторая страница.',
      'Широкая электрификация южных губерний даст мощный толчок подъёму сельского хозяйства.',
      'Latin tail: The quick brown fox.',
    ],
  ];
  for (const pageLines of lines) {
    const page = doc.addPage([595, 842]);
    pageLines.forEach((t, i) => page.drawText(t, { x: 40, y: 780 - i * 28, size: 13, font }));
  }
  fs.writeFileSync(path.join(out, 'cyrillic.pdf'), await doc.save({ useObjectStreams: true }));
}

// 4. cyrillic-pdfkit.pdf: another producer (PDFKit): Flate streams, classic xref, ToUnicode.
function cyrillicPdfkit() {
  return new Promise((resolve) => {
    const doc = new PDFKit({ size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
      fs.writeFileSync(path.join(out, 'cyrillic-pdfkit.pdf'), Buffer.concat(chunks));
      resolve();
    });
    doc.font(dejavu).fontSize(13);
    doc.text('Документ из PDFKit: первая страница.', 50, 60);
    doc.text('В чащах юга жил бы цитрус? Да, но фальшивый экземпляр!', 50, 90);
    doc.addPage();
    doc.text('Страница два: итого 1 234,56 ₽.', 50, 60);
    doc.end();
  });
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  latinRaw();
  await multiFlate();
  await cyrillic();
  await cyrillicPdfkit();
  // Feature check from the bytes (and from inflated object/xref streams).
  for (const f of fs
    .readdirSync(out)
    .filter((n) => n.endsWith('.pdf'))
    .sort()) {
    const b = fs.readFileSync(path.join(out, f));
    const raw = b.toString('latin1');
    let inflated = '';
    const re = /stream\r?\n/g;
    let m;
    // biome-ignore lint/suspicious/noAssignInExpressions: RegExp exec loop
    while ((m = re.exec(raw))) {
      const end = raw.indexOf('endstream', m.index);
      try {
        inflated += zlib.inflateSync(b.subarray(m.index + m[0].length, end)).toString('latin1');
      } catch {}
    }
    const all = raw + inflated;
    const has = (s) => all.includes(s);
    console.log(
      JSON.stringify({
        file: f,
        bytes: b.length,
        FlateDecode: has('/FlateDecode'),
        ObjStm: has('/ObjStm'),
        XRefStream: has('/Type /XRef') || has('/Type/XRef'),
        ToUnicode: has('/ToUnicode'),
        FontFile2: has('/FontFile2'),
        IdentityH: has('/Identity-H'),
        pages: (all.match(/\/Type\s*\/Page\b(?!s)/g) || []).length,
      }),
    );
  }
})();
