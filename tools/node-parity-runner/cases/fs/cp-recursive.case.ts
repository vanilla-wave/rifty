import type { ParityCase } from '../../src/types.ts';

// ADR-0090: fs.cpSync({ recursive: true }) deep-copies a tree and leaves the
// source intact, matching node:fs.cpSync.
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.mkdirSync('src/sub', { recursive: true });
    fs.writeFileSync('src/a.txt', 'A');
    fs.writeFileSync('src/sub/b.txt', 'B');
    fs.cpSync('src', 'dst', { recursive: true });
    console.log(JSON.stringify({
      a: fs.readFileSync('dst/a.txt', 'utf8'),
      b: fs.readFileSync('dst/sub/b.txt', 'utf8'),
      srcIntact: fs.existsSync('src/a.txt') && fs.existsSync('src/sub/b.txt'),
    }));
  `,
};

export default c;
