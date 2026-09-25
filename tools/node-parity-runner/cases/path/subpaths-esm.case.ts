import type { ParityCase } from '../../src/types.ts';

// Registration/identity only for win32; this does not certify Windows path operations.
const c: ParityCase = {
  kind: 'esm',
  code: `
    import path from 'node:path';
    import posix, { join } from 'node:path/posix';
    import plainPosix from 'path/posix';
    import win32 from 'node:path/win32';
    import plainWin32 from 'path/win32';
    console.log(posix === path.posix, posix === plainPosix, join === path.posix.join);
    console.log(win32 === path.win32, win32 === plainWin32);
    console.log(join('a', 'b'));
  `,
  expected: 'true true true\ntrue true\na/b\n',
};

export default c;
