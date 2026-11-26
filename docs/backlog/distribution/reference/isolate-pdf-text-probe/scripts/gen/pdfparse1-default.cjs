// pdf-parse 1.1.1, the README call: pdf(buffer).then(data => data.text). Whole text, one "page".
const fs = require('node:fs');
const pdf = require('pdf-parse-v1');
const { emit } = require('./_out.cjs');
(async () => {
  for (const file of process.argv.slice(2)) {
    const data = await pdf(fs.readFileSync(file));
    emit(file, [`numpages=${data.numpages}`, data.text]);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
