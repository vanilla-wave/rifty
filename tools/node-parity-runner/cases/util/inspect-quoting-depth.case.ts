import type { ParityCase } from '../../src/types.ts';

/**
 * Pins two `util.inspect` divergences fixed in silent-node-divergences:
 *  - strings inside structures use SINGLE quotes (Node), not double (was
 *    `JSON.stringify`); the dynamic quote falls back to `"`/`` ` `` like Node.
 *  - the 2nd positional is an OPTIONS object, not the internal depth counter —
 *    `{ depth: 0 }` collapses nested objects to `[Object]` and `{ depth: null }`
 *    renders unlimited. Previously `{ depth: null }` was misread as `depth=NaN`.
 */
const c: ParityCase = {
  code: `
    const util = require('node:util');
    console.log(util.inspect('hi'));
    console.log(util.inspect({ a: 'b', n: 1 }));
    console.log(util.inspect(['x', 'y']));
    console.log(util.inspect("it's"));
    console.log(util.inspect('a"b'));
    console.log(util.inspect({ a: { b: { c: 1 } } }, { depth: 0 }));
    console.log(util.inspect({ a: { b: { c: 1 } } }, { depth: 1 }));
    console.log(util.inspect({ a: { b: { c: 1 } } }, { depth: null }));
  `,
};

export default c;
