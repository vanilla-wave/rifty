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
        : [`${p}${e.name}=${fs.readFileSync(path.join(d, e.name), 'utf8').length}`],
    );
(async () => {
  const zip = new JSZip();
  zip.file('a.txt', 'alpha\n'.repeat(1000));
  zip.file('dir/b.txt', 'beta\n'.repeat(3000));
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
