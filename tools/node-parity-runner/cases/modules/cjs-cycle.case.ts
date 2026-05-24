import type { ParityCase } from '../../src/types.ts';

/**
 * Classic Node CJS cycle: `a.js` and `b.js` require each other. When `b`
 * requires `a` mid-evaluation, Node returns `a`'s partial exports (with
 * `done: false`). Once `b` finishes, `a` resumes and finally writes
 * `done: true`. This is the documented behaviour:
 * https://nodejs.org/api/modules.html#cycles
 *
 * Exercises:
 * - the loader's "module is mid-eval, return current exports" branch
 * - relative `require('./x.js')` from a sibling file in the same directory
 *   (this is what the parity-runner harness had to be taught to mount —
 *   setup files alongside the entry script in both environments).
 */
const c: ParityCase = {
  setup: {
    files: {
      'a.js': `
        console.log('a starting');
        exports.done = false;
        const b = require('./b.js');
        console.log('in a, b.done = ' + b.done);
        exports.done = true;
        console.log('a done');
      `,
      'b.js': `
        console.log('b starting');
        exports.done = false;
        const a = require('./a.js');
        console.log('in b, a.done = ' + a.done);
        exports.done = true;
        console.log('b done');
      `,
    },
  },
  code: `
    console.log('main starting');
    const a = require('./a.js');
    const b = require('./b.js');
    console.log('in main, a.done = ' + a.done + ', b.done = ' + b.done);
  `,
};

export default c;
