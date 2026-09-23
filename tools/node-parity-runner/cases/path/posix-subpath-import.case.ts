import type { ParityCase } from '../../src/types.ts';

/**
 * `node:path/posix` as an ESM builtin (vitest-run-in-browser I6): the exact
 * `@vitest/mocker/dist/node.js` line `import { join } from 'node:path/posix'`
 * links, and default / namespace / dynamic import all yield `path.posix`.
 * `path.win32` is NOT printed (traps.md parity-win32-alias).
 */
const c: ParityCase = {
  kind: 'esm',
  code: `
    import { join } from 'node:path/posix';
    import posixDefault, * as posixNs from 'node:path/posix';
    import path from 'node:path';

    console.log('join', join('a', 'b'), join('/x/', '../y', 'z.js'));
    console.log('default', posixDefault === path.posix);
    console.log('namespace', posixNs.default === path.posix, posixNs.join === path.posix.join);
    const dynamic = await import('node:path/posix');
    console.log('dynamic', dynamic.default === path.posix, dynamic.join === join);
  `,
  expected: ['join a/b /y/z.js', 'default true', 'namespace true true', 'dynamic true true'].join(
    '\n',
  ),
};

export default c;
