// unzipper 0.10.14 Extract (fstream -> graceful-fs -> fs.WriteStream) over a STORE zip (no zlib).
const fs = require('node:fs');
const path = require('node:path');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const JSZip = require('jszip');
const unzipper = require('unzipper');
const METHOD = 'STORE';
const zipPath = path.join(__dirname, 'a.zip');
const outDir = path.join(__dirname, 'unz');
const list = (d, p = '') =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((e) =>
      e.isDirectory()
        ? list(path.join(d, e.name), `${p}${e.name}/`)
        : [
            `${p}${e.name}=${require('node:crypto')
              .createHash('sha256')
              .update(fs.readFileSync(path.join(d, e.name)))
              .digest('hex')
              .slice(0, 16)}`,
          ],
    );
(async () => {
  const zip = new JSZip();
  zip.file('a.txt', Array.from({ length: 1000 }, (_, i) => `alpha ${i}\n`).join(''));
  zip.file('dir/b.txt', Array.from({ length: 3000 }, (_, i) => `beta ${i * 7}\n`).join(''));
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: METHOD });
  fs.writeFileSync(zipPath, buf);
  try {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: outDir }))
      .on('close', () => {
        try {
          console.log('extracted', list(outDir).join(' '));
        } catch (e) {
          console.log('close, then listing threw', e2s(e));
        }
      })
      .on('error', (e) => console.log('extract error', e2s(e)));
  } catch (e) {
    console.log('extract threw', e2s(e));
  }
})();
