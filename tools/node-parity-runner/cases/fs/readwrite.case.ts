import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'hello.txt': 'world',
    },
  },
  code: `
    const fs = require('node:fs');
    console.log(fs.readFileSync('hello.txt', 'utf8'));
    fs.writeFileSync('out.txt', 'new-content');
    console.log(fs.readFileSync('out.txt', 'utf8'));
    console.log(fs.existsSync('hello.txt'));
    console.log(fs.existsSync('missing.txt'));
  `,
};

export default c;
