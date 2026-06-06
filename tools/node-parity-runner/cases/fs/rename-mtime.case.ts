import type { ParityCase } from '../../src/types.ts';

// ADR-0083: fs.renameSync must MOVE (src gone, dst has the bytes) and PRESERVE
// mtime — the old read+write+rm path restamped mtime, which this catches
// (the printed mtime would diverge from Node's preserved value).
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.writeFileSync('src.txt', 'hello');
    fs.utimesSync('src.txt', 5, 5); // mtime = 5000ms
    const before = fs.statSync('src.txt').mtimeMs;
    fs.renameSync('src.txt', 'dst.txt');
    const after = fs.statSync('dst.txt').mtimeMs;
    console.log(JSON.stringify({
      existsSrc: fs.existsSync('src.txt'),
      content: fs.readFileSync('dst.txt', 'utf8'),
      mtimePreserved: before === after,
      mtime: after,
    }));
  `,
};

export default c;
