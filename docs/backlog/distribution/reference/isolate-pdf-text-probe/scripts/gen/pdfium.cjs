// @hyzyla/pdfium 3.0.0 (CommonJS entry over pdfium.wasm). Canonical per its README.
const fs = require('node:fs');
const { PDFiumLibrary } = require('@hyzyla/pdfium');
const { emit } = require('./_out.cjs');
(async () => {
  const library = await PDFiumLibrary.init();
  for (const file of process.argv.slice(2)) {
    const document = await library.loadDocument(fs.readFileSync(file));
    const pages = [];
    for (const page of document.pages()) pages.push(page.getText());
    emit(file, pages);
    document.destroy();
  }
  library.destroy();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
