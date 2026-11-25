// node resolve.cjs (in <root>/workspace): how `require` resolves the four libraries and what of the
// artifact is visible, with <root> cut from every path (sandbox template, I2).
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(__dirname);
const base = root === '/' ? '' : root;
const cut = (p) => (p.startsWith(`${base}/`) ? `<root>${p.slice(base.length)}` : p);
const libs = ['pdf-lib', 'docx', 'pptxgenjs', 'exceljs', 'pdf-lib/package.json'];
console.log(
  JSON.stringify({
    paths: module.paths.map(cut),
    resolved: Object.fromEntries(libs.map((l) => [l, cut(require.resolve(l))])),
    // Nothing of the artifact but its node_modules: no rifty/*, package.json or lock at the root.
    visible: ['rifty', 'payload', 'package.json', 'package-lock.json'].map((p) => [
      p,
      fs.existsSync(path.join(root, p)),
    ]),
    root: fs.readdirSync(root).sort(),
    // The tar's mtimes (the producer writes 0), as `tar -x` sets them.
    mtimeMs: ['node_modules', 'node_modules/pdf-lib', 'node_modules/pdf-lib/package.json'].map(
      (p) => fs.statSync(path.join(root, p)).mtimeMs,
    ),
  }),
);
