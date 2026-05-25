import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.writeFileSync('x', 'a');
    fs.utimesSync('x', 1, 2);
    console.log(JSON.stringify({ mtime: fs.statSync('x').mtimeMs }));
  `,
};

export default c;
