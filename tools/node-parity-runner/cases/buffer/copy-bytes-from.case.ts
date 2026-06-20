import type { ParityCase } from '../../src/types.ts';

/**
 * `Buffer.copyBytesFrom(view[, offset[, length]])` (v18.16) — copies a TypedArray
 * byte window (offset/length in the view's ELEMENTS) into a NEW Buffer. It's an
 * explicit copy, so mutating the source afterwards must not change the result.
 */
const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const u16 = new Uint16Array([1, 2, 3, 4]);
    const cb = Buffer.copyBytesFrom(u16, 1, 2);
    console.log(cb.length, cb.toString('hex'));
    const full = Buffer.copyBytesFrom(new Uint8Array([10, 20, 30]));
    console.log(full.length, full.toString('hex'));
    u16[1] = 0xffff; // explicit-copy: must NOT affect cb
    console.log(cb.toString('hex'));
  `,
};

export default c;
