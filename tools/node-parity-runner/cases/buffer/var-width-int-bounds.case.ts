import type { ParityCase } from '../../src/types.ts';

/**
 * Error-path parity for the variable-width Buffer int accessors: an out-of-range
 * `value` is `ERR_OUT_OF_RANGE` (never a silent `& 0xff` wrap), and an out-of-bounds
 * / non-integer `offset` or out-of-range `byteLength` is `ERR_OUT_OF_RANGE` (never the
 * bare DataView RangeError). Tags by `.code` (message prose isn't pinned). The
 * happy-path round-trips live in `var-width-int-tojson.case.ts`.
 */
const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const tag = (n, fn) => { try { const r = fn(); console.log(n, 'NO_THROW', r); } catch (e) { console.log(n, e.code || e.constructor.name); } };
    // out-of-range / negative value (was silently truncated)
    tag('wU.range', () => Buffer.alloc(3).writeUIntLE(0x1000000, 0, 3));
    tag('wU.neg',   () => Buffer.alloc(3).writeUIntLE(-1, 0, 3));
    tag('wUBE.range',() => Buffer.alloc(4).writeUIntBE(0x100000000, 0, 4));
    tag('wI.pos',   () => Buffer.alloc(3).writeIntLE(8388608, 0, 3));
    tag('wI.neg',   () => Buffer.alloc(3).writeIntLE(-8388609, 0, 3));
    tag('wIBE.pos', () => Buffer.alloc(4).writeIntBE(2147483648, 0, 4));
    // offset out of bounds / non-integer (was a bare RangeError or silent read)
    tag('rU.offOOB',() => Buffer.alloc(4).readUIntLE(5, 1));
    tag('rU.offBL', () => Buffer.alloc(4).readUIntLE(3, 2));
    tag('rU.frac',  () => Buffer.alloc(4).readUIntLE(0.5, 1));
    tag('rI.offOOB',() => Buffer.alloc(4).readIntBE(5, 1));
    tag('wU.offOOB',() => Buffer.alloc(4).writeUIntLE(1, 5, 1));
    tag('wU.offBL', () => Buffer.alloc(4).writeUIntLE(1, 3, 2));
    // byteLength out of 1..6
    tag('rU.bl0',   () => Buffer.alloc(4).readUIntLE(0, 0));
    tag('rU.bl7',   () => Buffer.alloc(8).readUIntLE(0, 7));
    tag('wI.bl7',   () => Buffer.alloc(8).writeIntLE(1, 0, 7));
    // non-number offset / byteLength → ERR_INVALID_ARG_TYPE (incl. undefined — args are required)
    tag('rU.offStr',  () => Buffer.alloc(4).readUIntLE('0', 1));
    tag('rU.offUndef',() => Buffer.alloc(4).readUIntLE(undefined, 1));
    tag('rU.offBool', () => Buffer.alloc(4).readUIntLE(true, 1));
    tag('rU.blStr',   () => Buffer.alloc(4).readUIntLE(0, '2'));
    tag('rU.blUndef', () => Buffer.alloc(4).readUIntLE(0));
    tag('wU.offStr',  () => Buffer.alloc(4).writeUIntLE(1, '0', 1));
    // valid edges still succeed (max unsigned / min signed for 6 bytes)
    tag('ok.umax',  () => Buffer.alloc(6).writeUIntLE(281474976710655, 0, 6));
    tag('ok.imin',  () => Buffer.alloc(6).writeIntLE(-140737488355328, 0, 6));
  `,
};

export default c;
