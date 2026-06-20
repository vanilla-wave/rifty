import type { ParityCase } from '../../src/types.ts';

/**
 * `path.toNamespacedPath` / `path.posix.toNamespacedPath` — POSIX identity no-op.
 * (`path.win32` is NOT exercised: rifty ships `win32 === posix` POSIX-only by
 * design, a pre-existing module-wide deviation from real Node's Windows path,
 * unrelated to this method.)
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
