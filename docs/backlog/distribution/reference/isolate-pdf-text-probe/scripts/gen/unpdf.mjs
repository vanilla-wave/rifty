// unpdf 2.2.3 (ES module only; serverless pdf.js build inside). Canonical.
import fs from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
for (const file of process.argv.slice(2)) {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  if (totalPages !== text.length) throw new Error('page count');
  console.log(JSON.stringify({ file, pages: text }));
}
