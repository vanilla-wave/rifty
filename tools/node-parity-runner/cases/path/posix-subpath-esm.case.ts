import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import path from 'node:path';
    import posix, { join } from 'node:path/posix';
    console.log(JSON.stringify({
      defaultIdentity: posix === path.posix,
      namedIdentity: join === posix.join,
      joined: join('a', 'b'),
    }));
  `,
  expected: '{"defaultIdentity":true,"namedIdentity":true,"joined":"a/b"}\n',
};

export default c;
