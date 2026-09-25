import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const p = require('node:process');
    console.log('initial', typeof p.exitCode, String(p.exitCode));
    for (const value of [3, undefined, 4, null, '7', 0]) {
      p.exitCode = value;
      console.log('assigned', typeof p.exitCode, String(p.exitCode));
    }
    p.exitCode = undefined;
    if (p.exitCode == null) p.exitCode = 1;
    console.log('startup-failure', p.exitCode);
    p.exitCode = undefined;
  `,
};

export default c;
