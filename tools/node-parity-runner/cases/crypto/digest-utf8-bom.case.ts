import type { ParityCase } from '../../src/types.ts';

// A 'utf8' digest decodes the raw digest bytes like Buffer#toString('utf8'):
// a digest starting EF BB BF keeps U+FEFF. sha256('bom12720048') starts
// efbbbf35 (found by search on Node v24.16.0).
const c: ParityCase = {
  code: `
    const crypto = require('node:crypto');
    const cps = (s) => s.length + ':' + [...s].slice(0, 2).map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    console.log('hex', crypto.createHash('sha256').update('bom12720048').digest('hex').slice(0, 8));
    console.log('createHash', cps(crypto.createHash('sha256').update('bom12720048').digest('utf8')));
    console.log('hash', cps(crypto.hash('sha256', 'bom12720048', 'utf8')));
  `,
};

export default c;
