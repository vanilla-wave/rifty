// node diag-outputs.cjs: the other output paths an agent may pick, one line each (`ok <bytes>` or
// the error), past the canonical generators' first stops: pptxgenjs outputTypes (with
// pptx-handled.cjs's rejection filter), docx Packer methods, exceljs over lib/doc/workbook
// (writeFile, CSV write/read, read back, sheet protection). The probe diffs the lines against real node.
const fs = require('node:fs');
process.on('unhandledRejection', (e) => {
  if (/isolate-host\.https/.test(e?.message)) return;
  console.error(e);
  process.exit(1);
});
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
fs.writeFileSync('dot.png', Buffer.from(PNG, 'base64'));
const size = (v) => {
  if (typeof v === 'string')
    return v.length <= 40 ? `string ${JSON.stringify(v)}` : `string ${v.length}`;
  if (v && typeof v.byteLength === 'number')
    return `${Object.prototype.toString.call(v).slice(8, -1)} ${v.byteLength}`;
  if (v && typeof v.size === 'number')
    return `${Object.prototype.toString.call(v).slice(8, -1)} ${v.size}`;
  if (v && typeof v.pipe === 'function') return 'stream';
  return typeof v;
};
const line = async (name, fn) => {
  try {
    console.log(`${name}: ok ${size(await fn())}`);
  } catch (e) {
    console.log(`${name}: ${e?.name}: ${String(e?.message).split('\n')[0]}`);
  }
};
const deck = () => {
  const PptxGenJS = require('pptxgenjs');
  const p = new PptxGenJS();
  p.addSlide().addText('x', { x: 1, y: 1 });
  return p;
};
(async () => {
  for (const t of [
    'nodebuffer',
    'base64',
    'arraybuffer',
    'uint8array',
    'binarystring',
    'blob',
    'STREAM',
  ])
    await line(`pptx.write(${t})`, () => deck().write({ outputType: t }));
  await line('pptx image by path + writeFile', () => {
    const p = deck();
    p.addSlide().addImage({ path: 'dot.png', x: 1, y: 1, w: 1, h: 1 });
    return p.writeFile({ fileName: 'path.pptx' }).then(() => fs.readFileSync('path.pptx'));
  });
  const { Document, Packer, Paragraph } = require('docx');
  const doc = () => new Document({ sections: [{ children: [new Paragraph('x')] }] });
  for (const m of ['toBuffer', 'toBase64String', 'toString', 'toBlob', 'toArrayBuffer'])
    await line(`docx Packer.${m}`, () => Packer[m](doc()));
  await line('docx Packer.toStream', () => Packer.toStream(doc()));
  const Workbook = require('exceljs/lib/doc/workbook');
  const wb = () => {
    const w = new Workbook();
    w.addWorksheet('S').addRow(['a', 1]);
    return w;
  };
  await line('exceljs xlsx.writeFile', () =>
    wb()
      .xlsx.writeFile('w.xlsx')
      .then(() => fs.readFileSync('w.xlsx')),
  );
  await line('exceljs xlsx.writeBuffer', () => wb().xlsx.writeBuffer());
  await line('exceljs csv.writeBuffer', () => wb().csv.writeBuffer());
  await line('exceljs xlsx.load (read back)', async () => {
    const w = new Workbook();
    await w.xlsx.load(await wb().xlsx.writeBuffer());
    return String(w.getWorksheet('S').getCell('B1').value);
  });
  await line('exceljs xlsx.readFile (read back)', async () => {
    const w = new Workbook();
    await w.xlsx.readFile('w.xlsx');
    return String(w.getWorksheet('S').getCell('A1').value);
  });
  await line('exceljs xlsx.load(fs.readFileSync) of a writeFile output', async () => {
    const w = new Workbook();
    await w.xlsx.load(fs.readFileSync('w.xlsx'));
    return String(w.getWorksheet('S').getCell('A1').value);
  });
  await line('exceljs xlsx.read(fs.createReadStream)', async () => {
    const w = new Workbook();
    await w.xlsx.read(fs.createReadStream('w.xlsx'));
    return String(w.getWorksheet('S').getCell('A1').value);
  });
  await line('exceljs csv.read(fs.createReadStream)', async () => {
    fs.writeFileSync('r.csv', 'a,1\nb,2\n');
    const w = new Workbook();
    const ws = await w.csv.read(fs.createReadStream('r.csv'));
    return `${ws.getCell('A2').value} ${ws.rowCount} rows`;
  });
  await line('exceljs worksheet.protect + writeBuffer', async () => {
    const w = wb();
    await w.getWorksheet('S').protect('pw', {});
    return w.xlsx.writeBuffer();
  });
  const { PDFDocument } = require('pdf-lib');
  await line('pdf-lib load + modify + save', async () => {
    const d = await PDFDocument.create();
    d.addPage();
    const again = await PDFDocument.load(await d.save());
    again.addPage();
    return again.save();
  });
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
