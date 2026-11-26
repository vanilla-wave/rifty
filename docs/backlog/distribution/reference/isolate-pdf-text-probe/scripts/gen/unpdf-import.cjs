// unpdf 2.2.3 from a CommonJS file: import() of the ES module.
const fs = require('node:fs');
const { emit } = require('./_out.cjs');
(async () => {
  const { extractText, getDocumentProxy } = await import('unpdf');
  for (const file of process.argv.slice(2)) {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
    const { text } = await extractText(pdf, { mergePages: false });
    emit(file, text);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
