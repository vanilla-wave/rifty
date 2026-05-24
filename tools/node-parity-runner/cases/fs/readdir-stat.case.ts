import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'a.txt': 'one',
      'b.txt': 'two two',
      'sub/c.txt': 'three',
    },
  },
  code: `
    const fs = require('node:fs');
    const names = fs.readdirSync('.').sort();
    console.log(JSON.stringify(names));
    console.log(fs.statSync('a.txt').size);
    console.log(fs.statSync('b.txt').size);
    console.log(fs.statSync('sub').isDirectory());
    console.log(fs.statSync('a.txt').isFile());
  `,
};

export default c;
