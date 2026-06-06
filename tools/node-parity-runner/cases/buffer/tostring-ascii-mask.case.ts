import type { ParityCase } from '../../src/types.ts';

// Node's `ascii` decode is 7-bit: each byte & 0x7f (0x80 -> U+0000,
// 0xFF -> U+007F). `latin1`/`binary` are the full 0-255 byte, unmasked.
const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const b = Buffer.from([0x41, 0x80, 0xFF, 0xC3, 0x7F]);
    console.log(JSON.stringify(b.toString('ascii')));
    console.log([...b.toString('ascii')].map((c) => c.charCodeAt(0)).join(','));
    console.log(JSON.stringify(b.toString('latin1')));
    console.log([...b.toString('latin1')].map((c) => c.charCodeAt(0)).join(','));
  `,
};

export default c;
