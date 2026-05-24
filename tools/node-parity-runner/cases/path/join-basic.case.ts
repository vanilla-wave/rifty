import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const path = require('node:path');
    console.log(path.posix.join('a', 'b', 'c'));
    console.log(path.posix.join('/x/', '/y/', 'z'));
    console.log(path.posix.join('foo', '..', 'bar'));
  `,
};

export default c;
