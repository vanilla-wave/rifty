// pdfjs-dist 6.5.438 legacy + worker, host-side esbuild → CommonJS (bundles/pdfjs-legacy.cjs). argv: <stubs|-> <pdf…>
require('./_stubs.cjs').install(process.argv[2]);
const fs = require('node:fs');
const { getDocument } = require('../bundles/pdfjs-legacy.cjs');
(async () => {
  for (const file of process.argv.slice(3)) {
    const task = getDocument({ data: new Uint8Array(fs.readFileSync(file)) });
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      pages.push(tc.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''));
    }
    console.log(JSON.stringify({ file, pages }));
    await task.destroy();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
