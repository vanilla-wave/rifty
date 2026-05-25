/**
 * `Buffer.alloc(size, fill, encoding)` must honor `encoding` when `fill` is a
 * string, and tile the encoded bytes across `size`. Previously the rifty
 * implementation always used utf8 and only wrote the first slice without
 * tiling.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');

    // utf8 default — tile 'abc' across 6 bytes
    console.log(Buffer.alloc(6, 'abc').toString('utf8'));
    // tile truncates last copy
    console.log(Buffer.alloc(5, 'ab').toString('utf8'));
    // utf16le — 1 char per 2 bytes, tiled
    console.log(Buffer.alloc(8, 'a', 'utf16le').toString('hex'));
    // hex — 'AB' encodes to one byte 0xab, tiled
    console.log(Buffer.alloc(4, 'AB', 'hex').toString('hex'));
    // ascii — char codes 0-255, tiled
    console.log(Buffer.alloc(4, 'AB', 'ascii').toString('hex'));
    // latin1
    console.log(Buffer.alloc(4, '\\xff\\x80', 'latin1').toString('hex'));
    // base64 — encoded bytes tiled
    console.log(Buffer.alloc(8, 'aGk=', 'base64').toString('hex'));
    // number fill — encoding is ignored
    console.log(Buffer.alloc(4, 0xaa, 'utf16le').toString('hex'));
  `,
};

export default c;
