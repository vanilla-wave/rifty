import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const util = require('node:util');
    console.log(util.format('hi %s, you are %d', 'world', 7));
    console.log(util.format('json=%j', { a: 1, b: [2, 3] }));
    console.log(typeof util.promisify);
  `,
};

export default c;
