// Step 4: pdfkit writes a compressed pdf (deflateSync); each FlateDecode stream, cut up to
// `endstream` with its EOL, is read back with inflateSync.
const zlib = require('node:zlib');
const { sha, writeOut } = require('./lib.js');
const PDFDocument = require('pdfkit');

const doc = new PDFDocument({ compress: true, info: { CreationDate: new Date() } });
const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const pdf = Buffer.concat(chunks);
  writeOut('out.pdf', pdf);
  for (let at = 0, n = 0; ; n++) {
    const start = pdf.indexOf('stream\n', at);
    if (start < 0) break;
    const end = pdf.indexOf('endstream', start);
    at = end + 'endstream'.length;
    const dict = pdf.subarray(pdf.lastIndexOf(' obj', start), start).toString('latin1');
    if (!dict.includes('/FlateDecode')) continue;
    const data = zlib.inflateSync(pdf.subarray(start + 'stream\n'.length, end));
    console.log(`stream ${n} ${data.length} ${sha(data)}`);
  }
});
for (let i = 0; i < 40; i++)
  doc.text(`Row ${i}: the quick brown fox jumps over the lazy dog ${i * 17}`);
doc.end();
