import type { ParityCase } from '../../src/types.ts';

/**
 * `node:path/posix` / `node:path/win32` subpath builtins (I6): identity with
 * the main module's namespaces, bare-specifier form, and real join output.
 * `expected` pinned from Node v24.16.0 so a two-runtimes-agree-on-wrong
 * regression cannot pass silently.
 */
const c: ParityCase = {
  expected: ['true', 'true', 'true', 'a/b', '/'].join('\n'),
  code: `
    const path = require('node:path');
    const posix = require('node:path/posix');
    const win32 = require('node:path/win32');
    const barePosix = require('path/posix');
    console.log(posix === path.posix);
    console.log(win32 === path.win32);
    console.log(barePosix === path.posix);
    console.log(posix.join('a', 'b'));
    console.log(posix.sep);
  `,
};

export default c;
