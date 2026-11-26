// pdfjs-dist 6.5.438 legacy build from a CommonJS file: import() of the ES module.
const fs = require('node:fs');
const { emit } = require('./_out.cjs');
(async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const file of process.argv.slice(2)) {
    const task = getDocument({ data: new Uint8Array(fs.readFileSync(file)) });
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      pages.push(tc.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''));
    }
    emit(file, pages);
    await task.destroy();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
