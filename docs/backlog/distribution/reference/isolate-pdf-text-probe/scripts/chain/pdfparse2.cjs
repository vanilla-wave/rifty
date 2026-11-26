// pdf-parse 2.4.5 (CommonJS entry as shipped). argv: <stubs|-> <pdf…>
require('./_stubs.cjs').install(process.argv[2]);
const fs = require('node:fs');
const { PDFParse } = require('pdf-parse');
(async () => {
  for (const file of process.argv.slice(3)) {
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(file)) });
    const result = await parser.getText();
    console.log(JSON.stringify({ file, pages: result.pages.map((p) => p.text) }));
    await parser.destroy();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
