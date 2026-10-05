import type { ParityCase } from '../../src/types.ts';

/**
 * Link-time surface of historically-absent builtin members (I6):
 * `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage` exist as
 * functions (rifty: named-loud stubs that throw NotImplementedError when
 * CALLED — the call-time divergence is a declared compat ❌, not part of
 * this parity surface). ESM named imports are the claimed wall (vitest's
 * cli-api / tinyexec), so they are the carrier; CJS identity cross-checks
 * ride along. No ambient `process` global reads — the in-process harness's
 * global is the HOST process (traps.md parity-runner-in-process); the rifty
 * process comes from `require('node:process')`. `.length` arity and `bind`
 * shape included — Node's observable surface. `expected` pinned from Node
 * v24.16.0.
 */
const c: ParityCase = {
  kind: 'esm',
  expected: ['function function function', 'function', '1 3 0', 'true true true'].join('\n'),
  code: `
    import { statfsSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import * as procNs from 'node:process';
    import { createRequire } from 'node:module';
    const req = createRequire(import.meta.url);
    const proc = req('node:process');
    console.log(typeof statfsSync, typeof spawnSync, typeof proc.memoryUsage);
    console.log(typeof proc.memoryUsage.bind(proc));
    console.log(statfsSync.length, spawnSync.length, proc.memoryUsage.length);
    console.log(
      statfsSync === req('node:fs').statfsSync,
      spawnSync === req('node:child_process').spawnSync,
      procNs.memoryUsage === proc.memoryUsage,
    );
  `,
};

export default c;
