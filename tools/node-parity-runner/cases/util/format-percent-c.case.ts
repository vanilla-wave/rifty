import type { ParityCase } from '../../src/types.ts';

/**
 * `util.format('%c', arg)`: the CSS directive CONSUMES its argument and emits
 * nothing (outside a browser console). Was falling through `default`, which kept
 * the literal `%c` AND un-consumed the arg (so it leaked as a trailing value).
 */
const c: ParityCase = {
  code: `
    const util = require('node:util');
    console.log(JSON.stringify(util.format('a%cb', 'X')));
    console.log(JSON.stringify(util.format('%c %s', 'css', 'tail')));
    console.log(JSON.stringify(util.format('%c', 'only')));
    console.log(JSON.stringify(util.format('no spec', 'extra')));
  `,
};

export default c;
