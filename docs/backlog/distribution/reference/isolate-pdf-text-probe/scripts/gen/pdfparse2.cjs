// pdf-parse 2.4.5 (CommonJS entry, pdfjs-dist 5.4.296 inside). Canonical: new PDFParse({data}).getText().
const fs = require('node:fs');
const { PDFParse } = require('pdf-parse');
const { emit } = require('./_out.cjs');
(async () => {
  for (const file of process.argv.slice(2)) {
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(file)) });
    const result = await parser.getText();
    emit(
      file,
      result.pages.map((p) => p.text),
    );
    await parser.destroy();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
