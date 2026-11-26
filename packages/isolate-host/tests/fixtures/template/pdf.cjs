// node pdf.cjs <out>: two pages, a standard font, text, a rectangle, a PNG and metadata.
const fs = require('node:fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const out = process.argv[2];
(async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Probe PDF');
  // Fixed dates (save() still stamps ModDate; the verifier masks it).
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 1)));
  doc.setModificationDate(new Date(Date.UTC(2026, 0, 1)));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const p1 = doc.addPage([595, 842]);
  p1.drawText('Quarterly report', { x: 50, y: 780, size: 24, font, color: rgb(0, 0, 0) });
  p1.drawRectangle({ x: 50, y: 700, width: 200, height: 20, color: rgb(1, 0, 0) });
  p1.drawImage(png, { x: 300, y: 650, width: 50, height: 50 });
  doc.addPage().drawText('Page two', { x: 50, y: 700, size: 12, font });
  fs.writeFileSync(out, await doc.save());
  console.log('wrote', out);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
