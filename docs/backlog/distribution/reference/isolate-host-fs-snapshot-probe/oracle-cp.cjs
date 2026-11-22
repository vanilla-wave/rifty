// Real-Node oracle: which fs.stat fields survive a timestamp-preserving copy of a tree.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-oracle-'));
const src = path.join(base, 'src');
const dst = path.join(base, 'dst');
fs.mkdirSync(path.join(src, 'empty'), { recursive: true });
fs.writeFileSync(path.join(src, 'f.bin'), Buffer.from([0, 255, 1]));
fs.utimesSync(path.join(src, 'f.bin'), 1700000000.5, 1600000000.25);
fs.utimesSync(path.join(src, 'empty'), 1700000001, 1600000001);
setTimeout(() => {
  fs.cpSync(src, dst, { recursive: true, preserveTimestamps: true });
  const fields = ['mode', 'size', 'nlink', 'mtimeMs', 'atimeMs', 'ctimeMs', 'birthtimeMs', 'ino'];
  for (const rel of ['f.bin', 'empty']) {
    const a = fs.statSync(path.join(src, rel));
    const b = fs.statSync(path.join(dst, rel));
    console.log(rel, JSON.stringify(Object.fromEntries(fields.map((k) => [k, a[k] === b[k]]))));
  }
  console.log('readdir', JSON.stringify(fs.readdirSync(src)) === JSON.stringify(fs.readdirSync(dst)));
  fs.rmSync(base, { recursive: true, force: true });
}, 50);
