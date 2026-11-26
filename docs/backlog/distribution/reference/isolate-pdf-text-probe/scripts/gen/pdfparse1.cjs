// pdf-parse 1.1.1 (CommonJS, bundled pdf.js v1.10.100). Canonical: pdf(buffer) + pagerender.
const fs = require('node:fs');
const pdf = require('pdf-parse-v1');
const { emit } = require('./_out.cjs');
(async () => {
  for (const file of process.argv.slice(2)) {
    const pages = [];
    const data = await pdf(fs.readFileSync(file), {
      pagerender: async (page) => {
        const tc = await page.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        });
        let lastY;
        let text = '';
        for (const item of tc.items) {
          text += lastY === item.transform[5] || lastY === undefined ? item.str : `\n${item.str}`;
          lastY = item.transform[5];
        }
        pages.push(text);
        return text;
      },
    });
    if (data.numpages !== pages.length)
      throw new Error(`numpages ${data.numpages} != ${pages.length}`);
    emit(file, pages);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
