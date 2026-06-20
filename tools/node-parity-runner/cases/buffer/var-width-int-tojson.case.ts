import type { ParityCase } from '../../src/types.ts';

/**
 * Variable-width (1–6 byte) Buffer integer accessors readUIntLE/BE + readIntLE/BE
 * (sign-extended) + the write mirrors (return offset+byteLength), plus toJSON's
 * `{ type: 'Buffer', data: [...] }` round-trip shape. Requires `node:buffer` so
 * rifty's Buffer prototype is exercised, not the runner's Node Buffer.
 */
const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const b = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
    console.log(b.readUIntLE(0, 6).toString(16));
    console.log(b.readUIntBE(0, 6).toString(16));
    console.log(b.readIntLE(0, 6));
    console.log(b.readIntBE(0, 6));
    console.log(b.readUIntLE(0, 3).toString(16));
    const w = Buffer.alloc(6);
    console.log(w.writeUIntLE(0x123456789a, 0, 5));
    console.log(w.readUIntLE(0, 5).toString(16));
    const w2 = Buffer.alloc(3);
    w2.writeIntBE(-1000, 0, 3);
    console.log(w2.readIntBE(0, 3));
    console.log(JSON.stringify(Buffer.from([1, 2, 3])));
    const round = Buffer.from(JSON.parse(JSON.stringify(Buffer.from([5, 6, 7]))).data);
    console.log(JSON.stringify(round));
  `,
};

export default c;
