// pdfjs-dist 6.5.438 legacy build (ES module only). Canonical Node usage.
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
for (const file of process.argv.slice(2)) {
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
