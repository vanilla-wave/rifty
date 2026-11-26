// unpdf 2.2.3, host-side esbuild → CommonJS (bundles/unpdf.cjs). argv: <stubs|-> <pdf…>
require('./_stubs.cjs').install(process.argv[2]);
const fs = require('node:fs');
const { extractText, getDocumentProxy } = require('../bundles/unpdf.cjs');
(async () => {
  for (const file of process.argv.slice(3)) {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
    const { text } = await extractText(pdf, { mergePages: false });
    console.log(JSON.stringify({ file, pages: text }));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
