/**
 * `process.umask()` is the mask new files/dirs are created under — Node's
 * invariant under any umask; the oracle's number depends on its environment,
 * so only the invariant is printed.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  // The runner's default modes keep the host's global `process`; the builtin is rifty's.
  code: `
    const process = require('node:process');
    const fs = require('node:fs');
    const m = process.umask();
    const perm = (p) => fs.statSync(p).mode & 0o777;
    fs.mkdirSync('u');
    fs.writeFileSync('u/w.txt', 'x');
    fs.closeSync(fs.openSync('u/o.txt', 'w'));
    fs.mkdirSync('u/r/s', { recursive: true });
    console.log(JSON.stringify({
      type: typeof m,
      range: Number.isInteger(m) && m >= 0 && m <= 0o777,
      undef: process.umask(undefined) === m,
      file: [perm('u/w.txt'), perm('u/o.txt')].map((p) => p === (0o666 & ~m)),
      dir: [perm('u'), perm('u/r'), perm('u/r/s')].map((p) => p === (0o777 & ~m)),
    }));
  `,
  expected:
    '{"type":"number","range":true,"undef":true,"file":[true,true],"dir":[true,true,true]}\n',
};

export default c;
