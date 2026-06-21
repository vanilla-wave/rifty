import type { ParityCase } from '../../src/types.ts';

/**
 * `require('node:buffer').INSPECT_MAX_BYTES = N` is validated on assign: a non-number
 * is `ERR_INVALID_ARG_TYPE`, a negative is `ERR_OUT_OF_RANGE` — never silently stored.
 * A rejected assignment leaves the previous value intact; a valid one takes effect.
 */
const c: ParityCase = {
  code: `
    const buf = require('node:buffer');
    const v = (n, fn) => { try { fn(); console.log(n, 'NO_THROW'); } catch (e) { console.log(n, e.code); } };
    v('neg',  () => { buf.INSPECT_MAX_BYTES = -5; });
    v('nan',  () => { buf.INSPECT_MAX_BYTES = NaN; });
    v('str',  () => { buf.INSPECT_MAX_BYTES = 'x'; });
    v('null', () => { buf.INSPECT_MAX_BYTES = null; });
    console.log('unchanged', buf.INSPECT_MAX_BYTES);
    buf.INSPECT_MAX_BYTES = 5; // valid
    console.log('set', buf.INSPECT_MAX_BYTES);
    buf.INSPECT_MAX_BYTES = 50; // restore default
  `,
};

export default c;
