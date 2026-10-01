import type { ParityCase } from '../../src/types.ts';

/**
 * Link-time surface of historically-absent builtin members (I6):
 * `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage` exist as
 * functions (rifty: named-loud stubs that throw NotImplementedError when
 * CALLED — the call-time divergence is a declared compat ❌, not part of
 * this parity surface). `.length` arity and `bind` shape included — Node's
 * observable surface. `expected` pinned from Node v24.16.0.
 */
const c: ParityCase = {
  expected: ['function function function', 'function', '1 3 0'].join('\n'),
  code: `
    const fs = require('node:fs');
    const cp = require('node:child_process');
    console.log(typeof fs.statfsSync, typeof cp.spawnSync, typeof process.memoryUsage);
    console.log(typeof process.memoryUsage.bind(process));
    console.log(fs.statfsSync.length, cp.spawnSync.length, process.memoryUsage.length);
  `,
};

export default c;
