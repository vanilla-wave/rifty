// mupdf 1.28.6 (ES module only, WASM). Canonical.
import fs from 'node:fs';
import * as mupdf from 'mupdf';
for (const file of process.argv.slice(2)) {
  const doc = mupdf.Document.openDocument(fs.readFileSync(file), 'application/pdf');
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++)
    pages.push(doc.loadPage(i).toStructuredText('preserve-whitespace').asText());
  console.log(JSON.stringify({ file, pages }));
}
