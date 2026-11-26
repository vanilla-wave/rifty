// pdf.js-extract 1.0.1: its CommonJS entry is a promise of the class (it import()s its ES module).
const fs = require('node:fs');
const { emit } = require('./_out.cjs');
(async () => {
  const PDFExtract = await require('pdf.js-extract');
  const extract = new PDFExtract();
  for (const file of process.argv.slice(2)) {
    const data = await extract.extractBuffer(fs.readFileSync(file), {});
    emit(
      file,
      data.pages.map((p) => p.content.map((c) => c.str).join('\n')),
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
