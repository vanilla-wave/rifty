import type { ParityCase } from '../../src/types.ts';

// runtime-js/path-posix-win32-builtins: `node:path/posix` and `node:path/win32`
// registered as builtins. Node: `require('path/posix') === require('path').posix`.
const c: ParityCase = {
  code: `
    const path = require('node:path');
    const posix = require('node:path/posix');
    const win32 = require('node:path/win32');
    console.log(posix.join('a', 'b'));
    console.log(posix === path.posix);
    console.log(win32 === path.win32);
    console.log(posix.sep, posix.delimiter);
  `,
};

export default c;
