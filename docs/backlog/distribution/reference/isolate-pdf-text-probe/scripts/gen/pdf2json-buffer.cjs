// pdf2json 4.1.1, bytes instead of a path: parseBuffer(fs.readFileSync(file)).
const fs = require('node:fs');
const PDFParser = require('pdf2json');
const { emit } = require('./_out.cjs');
const one = (file) =>
  new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataError', (e) => reject(e.parserError || e));
    parser.on('pdfParser_dataReady', (data) =>
      resolve(
        data.Pages.map((p) =>
          p.Texts.map((t) => t.R.map((r) => decodeURIComponent(r.T)).join('')).join('\n'),
        ),
      ),
    );
    parser.parseBuffer(fs.readFileSync(file));
  });
(async () => {
  for (const file of process.argv.slice(2)) emit(file, await one(file));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
