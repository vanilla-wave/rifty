// pdf-parse text extraction; its bundled pdfjs selects the Node branch by the same `isNodeJS`.
const { readFileSync } = require('node:fs');
const { PDFParse } = require('pdf-parse');

(async () => {
  const result = {};
  for (const file of ['invoice.pdf', 'report.pdf']) {
    const parser = new PDFParse({ data: readFileSync(file) });
    const { total, text } = await parser.getText();
    result[file] = { total, text };
    await parser.destroy();
  }
  console.log(`RESULT ${JSON.stringify(result)}`);
})();
