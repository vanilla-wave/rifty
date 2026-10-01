import type { ParityCase } from '../../src/types.ts';

/**
 * ESM shape of the `node:path/posix` / `node:path/win32` subpaths (I6):
 * named import links, default imports return the main module's live
 * namespaces. `expected` pinned from Node v24.16.0.
 */
const c: ParityCase = {
  kind: 'esm',
  expected: ['a/b', 'true', 'true'].join('\n'),
  code: `
    import path from 'node:path';
    import posixDefault, { join } from 'node:path/posix';
    import win32Default from 'node:path/win32';
    console.log(join('a', 'b'));
    console.log(posixDefault === path.posix);
    console.log(win32Default === path.win32);
  `,
};

export default c;
