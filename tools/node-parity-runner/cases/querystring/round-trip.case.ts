import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const qs = require('node:querystring');
    const obj = { name: 'Иван', tags: ['a', 'b'], n: '42' };
    const s = qs.stringify(obj);
    console.log(s);
    console.log(JSON.stringify(qs.parse(s)));
  `,
};

export default c;
