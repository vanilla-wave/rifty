// pdfjs-dist legacy build with no workerSrc: Node detection (`isNodeJS`) selects its in-process fake worker.
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const result = {};
for (const file of ['invoice.pdf', 'report.pdf']) {
  const task = getDocument({ data: new Uint8Array(readFileSync(file)) });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }
  result[file] = pages;
  await task.destroy();
}
console.log(`RESULT ${JSON.stringify(result)}`);
