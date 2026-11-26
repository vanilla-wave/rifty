// pdfreader 3.0.8, bytes instead of a path: parseBuffer(buffer, cb).
const fs = require('node:fs');
const { PdfReader } = require('pdfreader');
const { emit } = require('./_out.cjs');
const one = (file) =>
  new Promise((resolve, reject) => {
    const pages = [];
    new PdfReader().parseBuffer(fs.readFileSync(file), (err, item) => {
      if (err) reject(err);
      else if (!item) resolve(pages.map((p) => p.join('\n')));
      else if (item.page) pages[item.page - 1] = [];
      else if (item.text) pages[pages.length - 1].push(item.text);
    });
  });
(async () => {
  for (const file of process.argv.slice(2)) emit(file, await one(file));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
