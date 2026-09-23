import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const path = require('node:path');
    const posix = require('node:path/posix');
    const bare = require('path/posix');
    const mod = require('node:module');
    console.log(JSON.stringify({
      nodeIdentity: posix === path.posix,
      bareIdentity: bare === posix,
      isBuiltin: mod.isBuiltin('node:path/posix'),
      joined: posix.join('a', 'b'),
    }));
  `,
  expected: '{"nodeIdentity":true,"bareIdentity":true,"isBuiltin":true,"joined":"a/b"}\n',
};

export default c;
