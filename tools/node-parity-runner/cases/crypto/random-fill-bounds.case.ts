import type { ParityCase } from '../../src/types.ts';

/**
 * `randomFill`/`randomFillSync` offset/size window contract, pinned head-to-head
 * against Node:
 *  - non-integer offset/size FLOOR (no throw),
 *  - a negative / NaN / past-the-buffer offset or size throws
 *    `RangeError [ERR_OUT_OF_RANGE]` (incl. `offset + size > length`),
 *  - a string buffer throws `TypeError [ERR_INVALID_ARG_TYPE]`, but a raw
 *    `ArrayBuffer` is ACCEPTED and filled in place (Node's randomFill takes both
 *    a view and a raw ArrayBuffer — unlike `hash`, which rejects the raw form),
 *  - the async overload validates the window SYNCHRONOUSLY (throws, never `cb(err)`).
 * Filled bytes are non-deterministic, so only NOTHROW/length/error shape is diffed.
 */
const c: ParityCase = {
  expected: [
    'off-floor:NOTHROW len=6',
    'size-floor:NOTHROW len=6',
    'neg-off:RangeError/ERR_OUT_OF_RANGE',
    'nan-off:RangeError/ERR_OUT_OF_RANGE',
    'size-overflow:RangeError/ERR_OUT_OF_RANGE',
    'off-plus-size:RangeError/ERR_OUT_OF_RANGE',
    'neg-size:RangeError/ERR_OUT_OF_RANGE',
    'nonview:TypeError/ERR_INVALID_ARG_TYPE',
    'arraybuffer-ok:true bl=8',
    'async-bad-off:RangeError/ERR_OUT_OF_RANGE',
    'async-ok:err=null same=true',
  ].join('\n'),
  code: `
    const crypto = require('node:crypto');
    const e = (fn) => { try { fn(); return 'NOTHROW'; } catch (x) { return x.name + '/' + x.code; } };
    const len = (fn) => { const b = fn(); return 'NOTHROW len=' + b.length; };
    console.log('off-floor:' + len(() => crypto.randomFillSync(Buffer.alloc(6), 1.9)));
    console.log('size-floor:' + len(() => crypto.randomFillSync(Buffer.alloc(6), 0, 1.9)));
    console.log('neg-off:' + e(() => crypto.randomFillSync(Buffer.alloc(4), -1)));
    console.log('nan-off:' + e(() => crypto.randomFillSync(Buffer.alloc(4), NaN)));
    console.log('size-overflow:' + e(() => crypto.randomFillSync(Buffer.alloc(4), 0, 7)));
    console.log('off-plus-size:' + e(() => crypto.randomFillSync(Buffer.alloc(4), 3, 3)));
    console.log('neg-size:' + e(() => crypto.randomFillSync(Buffer.alloc(4), 0, -1)));
    console.log('nonview:' + e(() => crypto.randomFillSync('hello', 0, 2)));
    // A raw ArrayBuffer is accepted and returned (Node fills it in place).
    const ab = new ArrayBuffer(8);
    console.log('arraybuffer-ok:' + (crypto.randomFillSync(ab, 0, 4) === ab) + ' bl=' + ab.byteLength);
    // The async overload still throws the window error SYNCHRONOUSLY.
    console.log('async-bad-off:' + e(() => crypto.randomFill(Buffer.alloc(4), 10, 2, () => {})));
    const target = Buffer.alloc(4);
    crypto.randomFill(target, (err, b) => console.log('async-ok:err=' + JSON.stringify(err) + ' same=' + (b === target)));
  `,
};

export default c;
