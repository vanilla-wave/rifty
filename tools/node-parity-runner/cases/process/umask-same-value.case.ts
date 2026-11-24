/** `process.umask(current)` (number or octal string) returns the previous mask, as Node. */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  // The runner's default modes keep the host's global `process`; the builtin is rifty's.
  code: `
    const process = require('node:process');
    const m = process.umask();
    console.log(JSON.stringify([
      process.umask(m) === m,
      process.umask(m.toString(8)) === m,
      process.umask(m, 'extra') === m,
      process.umask() === m,
    ]));
  `,
  expected: '[true,true,true,true]\n',
};

export default c;
