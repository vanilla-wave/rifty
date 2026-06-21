import type { ParityCase } from '../../src/types.ts';

/** `fs.lutimesSync` — identical to utimes under the no-symlink VFS (ADR-0050). */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.writeFileSync('lu.txt', 'L');
    fs.lutimesSync('lu.txt', 100, 200);
    console.log(JSON.stringify({ mtimeMs: fs.statSync('lu.txt').mtimeMs }));
  `,
};

export default c;
