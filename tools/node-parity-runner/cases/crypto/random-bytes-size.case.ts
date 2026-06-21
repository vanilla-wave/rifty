import type { ParityCase } from '../../src/types.ts';

/**
 * `randomBytes(size)` size contract, pinned head-to-head against Node:
 *  - sizes above the Web Crypto 65536-byte `getRandomValues` cap still succeed
 *    (the fill core chunks), so `randomBytes(70000).length === 70000` — Node has
 *    no such cap, and a non-chunking core would throw `QuotaExceededError` here,
 *  - non-integer sizes floor (Node truncates: `randomBytes(1.5).length === 1`),
 *  - out-of-range sizes throw `RangeError [ERR_OUT_OF_RANGE]` (`< 0`, `> 2^31-1`).
 */
const c: ParityCase = {
  expected: [
    'big:70000',
    'float:1',
    'float2:2',
    'zero:0',
    'neg:RangeError/ERR_OUT_OF_RANGE',
    'negfrac:RangeError/ERR_OUT_OF_RANGE',
    'toobig:RangeError/ERR_OUT_OF_RANGE',
    'nan:RangeError/ERR_OUT_OF_RANGE',
  ].join('\n'),
  code: `
    const crypto = require('node:crypto');
    const e = (fn) => { try { fn(); return 'NOTHROW'; } catch (x) { return x.name + '/' + x.code; } };
    console.log('big:' + crypto.randomBytes(70000).length);
    console.log('float:' + crypto.randomBytes(1.5).length);
    console.log('float2:' + crypto.randomBytes(2.9).length);
    console.log('zero:' + crypto.randomBytes(0).length);
    console.log('neg:' + e(() => crypto.randomBytes(-1)));
    // A negative fraction floors to -0; Node validates the raw value and throws.
    console.log('negfrac:' + e(() => crypto.randomBytes(-0.5)));
    console.log('toobig:' + e(() => crypto.randomBytes(2 ** 31)));
    console.log('nan:' + e(() => crypto.randomBytes(NaN)));
  `,
};

export default c;
