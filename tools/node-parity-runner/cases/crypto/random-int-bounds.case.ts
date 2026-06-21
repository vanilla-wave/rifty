import type { ParityCase } from '../../src/types.ts';

/**
 * `randomInt([min, ]max[, cb])` (Node v14.10) bounds + error contract, pinned
 * head-to-head against Node. Only the deterministic surface is diffed (the
 * random values are covered by the rifty-side unit test's unbiasedness proof):
 *  - trivial single-value ranges are deterministic (`randomInt(5,6) === 5`),
 *  - bad bounds throw `RangeError [ERR_OUT_OF_RANGE]` (max ≤ min, range > 2^48-1),
 *  - non-integer bounds throw `TypeError [ERR_INVALID_ARG_TYPE]`,
 *  - the callback overload validates bounds SYNCHRONOUSLY (throws, not `cb(err)`),
 *  - the async happy path calls `cb(undefined, n)` (err is `undefined`, not null).
 * Error `.message` is intentionally not diffed (Node-version-specific wording).
 */
const c: ParityCase = {
  expected: [
    'ri1:0',
    'ri56:5',
    'ri-neg:-3',
    'ri0:RangeError/ERR_OUT_OF_RANGE',
    'ri-lohi:RangeError/ERR_OUT_OF_RANGE',
    'ri-big:RangeError/ERR_OUT_OF_RANGE',
    'ri-big1:RangeError/ERR_OUT_OF_RANGE',
    'ri-float:TypeError/ERR_INVALID_ARG_TYPE',
    'ri-float2:TypeError/ERR_INVALID_ARG_TYPE',
    'ri-async-bad:RangeError/ERR_OUT_OF_RANGE',
    'ri-async-ok:err=true n=0',
  ].join('\n'),
  code: `
    const crypto = require('node:crypto');
    const e = (fn) => { try { fn(); return 'NOTHROW'; } catch (x) { return x.name + '/' + x.code; } };
    console.log('ri1:' + crypto.randomInt(1));
    console.log('ri56:' + crypto.randomInt(5, 6));
    console.log('ri-neg:' + crypto.randomInt(-3, -2));
    console.log('ri0:' + e(() => crypto.randomInt(0)));
    console.log('ri-lohi:' + e(() => crypto.randomInt(10, 5)));
    console.log('ri-big:' + e(() => crypto.randomInt(0, 2 ** 48)));
    console.log('ri-big1:' + e(() => crypto.randomInt(0, 2 ** 48 + 1)));
    console.log('ri-float:' + e(() => crypto.randomInt(1.5)));
    console.log('ri-float2:' + e(() => crypto.randomInt(0, 1.5)));
    console.log('ri-async-bad:' + e(() => crypto.randomInt(10, 5, () => {})));
    crypto.randomInt(0, 1, (err, n) => console.log('ri-async-ok:err=' + (err === undefined) + ' n=' + n));
  `,
};

export default c;
