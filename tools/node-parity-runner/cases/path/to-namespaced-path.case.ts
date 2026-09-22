import type { ParityCase } from '../../src/types.ts';

/**
 * `path.toNamespacedPath` / `path.posix.toNamespacedPath` — POSIX identity no-op.
 * (`path.win32` is the Windows algorithm and is not exercised here.)
 */
const c: ParityCase = {
  code: `
    const path = require('node:path');
    console.log(JSON.stringify(path.toNamespacedPath('/a/b')));
    console.log(JSON.stringify(path.toNamespacedPath('a/b')));
    console.log(JSON.stringify(path.posix.toNamespacedPath('/a/b')));
    console.log(JSON.stringify(path.toNamespacedPath('')));
  `,
};

export default c;
