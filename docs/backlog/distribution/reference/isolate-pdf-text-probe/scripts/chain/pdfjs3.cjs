// pdfjs-dist 3.11.174 legacy (CommonJS as shipped). argv: <stubs|-> <pdf…>
require('./_stubs.cjs').install(process.argv[2]);
const fs = require('node:fs');
const pdfjs = require('pdfjs-dist-v3/legacy/build/pdf.js');
(async () => {
  for (const file of process.argv.slice(3)) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      pages.push(tc.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''));
    }
    console.log(JSON.stringify({ file, pages }));
    await doc.destroy();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
