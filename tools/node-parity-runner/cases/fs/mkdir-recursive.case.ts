import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    fs.mkdirSync('a/b/c', { recursive: true });
    fs.writeFileSync('a/b/c/note.txt', 'hi');
    console.log(fs.readdirSync('a/b/c').sort().join(','));
    console.log(fs.readFileSync('a/b/c/note.txt', 'utf8'));
  `,
};

export default c;
