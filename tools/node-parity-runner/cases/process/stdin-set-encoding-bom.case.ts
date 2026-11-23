import type { ParityCase } from '../../src/types.ts';

// process.stdin.setEncoding('utf8') keeps a leading BOM, also split across
// stdin chunks, like Node's StringDecoder.
const c: ParityCase = {
  stdin: [new Uint8Array([0xef, 0xbb]), new Uint8Array([0xbf, 0x41])],
  code: `
    const process = require('node:process');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    process.stdin.setEncoding('utf8');
    let out = '';
    process.stdin.on('data', (chunk) => { out += chunk; });
    process.stdin.on('end', () => { console.log('stdin', cps(out)); });
  `,
};

export default c;
