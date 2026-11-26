// mupdf 1.28.6 from a CommonJS file: import() of the ES module.
const fs = require('node:fs');
const { emit } = require('./_out.cjs');
(async () => {
  const mupdf = await import('mupdf');
  for (const file of process.argv.slice(2)) {
    const doc = mupdf.Document.openDocument(fs.readFileSync(file), 'application/pdf');
    const pages = [];
    for (let i = 0; i < doc.countPages(); i++)
      pages.push(doc.loadPage(i).toStructuredText('preserve-whitespace').asText());
    emit(file, pages);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
