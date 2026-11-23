import type { ParityCase } from '../../src/types.ts';

// Node latin1/binary maps byte b to U+00bb; WHATWG 'latin1' is windows-1252
// (0x80 -> U+20AC). Readable#setEncoding must follow Node.
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    const bytes = [0x41, 0x80, 0x8a, 0x9f, 0xa0, 0xff];
    for (const enc of ['latin1', 'binary']) {
      const src = new Readable({ read() {} });
      src.setEncoding(enc);
      let out = '';
      src.on('data', (c) => { out += c; });
      src.on('end', () => console.log(enc, src.readableEncoding, cps(out)));
      src.push(Buffer.from(bytes.slice(0, 3)));
      src.push(Buffer.from(bytes.slice(3)));
      src.push(null);
    }
  `,
};

export default c;
