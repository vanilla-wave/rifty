/** Node's `parseFileMode('mask')` errors: type, integer, uint32 range, octal string. */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  // The runner's default modes keep the host's global `process`; the builtin is rifty's.
  code: `
    const process = require('node:process');
    const m = process.umask();
    const args = [
      ['null', null], ['true', true], ['{}', {}], ['[]', []], ['10n', 10n],
      ['symbol', Symbol('s')], ['fn', function named() {}], ['arrow', () => 0],
      ['1.5', 1.5], ['NaN', NaN], ['Infinity', Infinity], ['-1', -1], ['2**32', 2 ** 32],
      ['big', 2 ** 40], ['77777777777', '77777777777'], ['8', '8'], ['0o22', '0o22'],
      ['empty', ''], ['space', ' 22'], ['0x12', '0x12'], ['abc', 'abc'], ['quote', "it's"],
    ];
    for (const [label, a] of args) {
      try {
        process.umask(a);
        console.log(label, 'accepted');
      } catch (e) {
        console.log(label, e instanceof TypeError, e instanceof RangeError, e.name, e.code, e.message);
      }
    }
    console.log('unchanged', process.umask() === m);
  `,
};

export default c;
