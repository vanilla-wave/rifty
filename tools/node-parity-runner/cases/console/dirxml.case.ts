import type { ParityCase } from '../../src/types.ts';

/**
 * `console.dirxml(...data)` is, for non-DOM data, exactly `this.log(...data)`.
 * Driven through a `Console` over a real `Writable` capture sink (same pattern as
 * console-class.case.ts — Node validates the stdout is a stream), so both
 * runtimes format identically (printf via util.format + the inspector).
 */
const c: ParityCase = {
  code: `
    const { Console } = require('node:console');
    const { Writable } = require('node:stream');
    function cap(fn) {
      return new Promise((resolve) => {
        let out = '';
        const w = new Writable({ write(chunk, _enc, cb) { out += chunk; cb(); resolve(out); } });
        const logger = new Console({ stdout: w });
        fn(logger);
      });
    }
    (async () => {
      const log = [];
      log.push(['dirxml-obj', await cap((c) => c.dirxml({ a: 1 }, 'tail'))]);
      log.push(['dirxml-prim', await cap((c) => c.dirxml('plain', 42))]);
      console.log(JSON.stringify(log));
    })();
  `,
};

export default c;
