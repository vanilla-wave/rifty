import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const util = require('node:util');
    console.log(util.format('hi %s, you are %d', 'world', 7));
    console.log(util.format('json=%j', { a: 1, b: [2, 3] }));
    // %s of a (shallow) object inspects it structurally, like Node's
    // formatWithOptions; bigints get the trailing 'n'.
    console.log(util.format('obj=%s', { a: 1 }));
    console.log(util.format('arr=%s', [1, 2]));
    console.log(util.format('big=%s', 10n));
    console.log(util.format('nul=%s', null));
    console.log(typeof util.promisify);
  `,
};

export default c;
