import type { ParityCase } from '../../src/types.ts';

// A Buffer path is raw name bytes in Node: a leading EF BB BF stays part of
// the file name (U+FEFF), never a different file.
const c: ParityCase = {
  cwd: '/bompath',
  code: `
    const fs = require('node:fs');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    fs.writeFileSync(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), 'x');
    console.log('names', fs.readdirSync('.').map(cps).join(','));
    console.log('exists-plain', fs.existsSync('a'));
    console.log('exists-bom', fs.existsSync('\\ufeffa'));
  `,
};

export default c;
