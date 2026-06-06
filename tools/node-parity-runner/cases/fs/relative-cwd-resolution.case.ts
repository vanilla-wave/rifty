import type { ParityCase } from '../../src/types.ts';

/**
 * #6 (perf audit 2026-06-05) — dropping the redundant OUTER `normalizePath` in
 * `fs.resolvePath`'s relative branch (`joinPath` already normalizes). Locks
 * that relative + dot-segment resolution anchored at the process cwd stays
 * Node-equal: bare relative, `./`, `../`-back-into-self, and nested `../`
 * collapse, plus `readdirSync` on relative dirs.
 *
 * Harness note: the parity runner can't drive `process.chdir` on the rifty side
 * (rifty's in-process run uses the real harness `process`, decoupled from the
 * rifty fs cwd cell, which the runner pins via `setProcessCwd('/')`). So this
 * case exercises the relative branch at the pinned cwd — rifty resolves
 * against `/`, the Node child against its tmpdir cwd — which is exactly the
 * `joinPath(getProcessCwd(), str)` path #6 touches. The non-root-cwd case is
 * covered by the `packages/runtime-js/src/builtins/fs.test.ts` unit (canonical
 * for #6's cwd handling).
 */
const c: ParityCase = {
  expected: ['hi', 'deep', 'hi', 'hi', 'data.txt,sub', 'n.txt'].join('\n'),
  setup: {
    files: {
      'work/data.txt': 'hi',
      'work/sub/n.txt': 'deep',
    },
  },
  code: `
    const fs = require('node:fs');
    console.log(fs.readFileSync('work/data.txt', 'utf8'));
    console.log(fs.readFileSync('./work/sub/n.txt', 'utf8'));
    console.log(fs.readFileSync('work/../work/data.txt', 'utf8'));
    console.log(fs.readFileSync('work/sub/../data.txt', 'utf8'));
    console.log(fs.readdirSync('work').sort().join(','));
    console.log(fs.readdirSync('./work/sub').sort().join(','));
  `,
};

export default c;
