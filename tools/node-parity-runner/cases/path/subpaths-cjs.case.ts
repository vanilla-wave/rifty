import type { ParityCase } from '../../src/types.ts';

// Registration/identity only for win32; this does not certify Windows path operations.
const c: ParityCase = {
  code: `
    const path = require('node:path');
    for (const flavour of ['posix', 'win32']) {
      const plain = require('path/' + flavour);
      const prefixed = require('node:path/' + flavour);
      console.log(flavour, plain === path[flavour], prefixed === plain);
    }
    console.log(require('node:path/posix').join('a', 'b'));
  `,
  expected: 'posix true true\nwin32 true true\na/b\n',
};

export default c;
