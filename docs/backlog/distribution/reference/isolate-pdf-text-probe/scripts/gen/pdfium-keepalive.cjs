// @hyzyla/pdfium 3.0.0 with a timer held while the library initialises (PROBE: the guest ends a run
// while an async WebAssembly compile is still pending; a pending timer keeps it alive).
const fs = require('node:fs');
const { PDFiumLibrary } = require('@hyzyla/pdfium');
const { emit } = require('./_out.cjs');
(async () => {
  const keep = setInterval(() => {}, 50);
  const library = await PDFiumLibrary.init();
  clearInterval(keep);
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
