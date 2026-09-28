import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { fork } = require('node:child_process');
    for (const execArgv of [true, 1, {}, () => {}]) {
      try { fork('/unused.cjs', [], { execArgv }); }
      catch (error) { console.log(error.name, error.code, error.message); }
    }
  `,
};
export default c;
