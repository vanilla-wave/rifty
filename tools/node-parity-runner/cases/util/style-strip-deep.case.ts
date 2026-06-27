import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const util = require('node:util');
    const out = [];
    const styled = util.styleText(['red', 'bold'], 'x', { validateStream: false });
    out.push(['styledHex', Buffer.from(styled).toString('hex')]);
    out.push(['stripped', util.stripVTControlCharacters(styled)]);
    out.push(['deepMap', util.isDeepStrictEqual(new Map([['a', { n: 1 }]]), new Map([['a', { n: 1 }]]))]);
    out.push(['deepSetMismatch', util.isDeepStrictEqual(new Set([{ n: 1 }]), new Set([{ n: 2 }]))]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
