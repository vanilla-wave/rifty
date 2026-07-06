import type { ParityCase } from '../../src/types.ts';

/**
 * #6 (perf audit 2026-06-05) — dropping the redundant OUTER `normalizePath` in
 * `fs.resolvePath`'s relative branch (`joinPath` already normalizes). Locks
 * that relative + dot-segment resolution anchored at the process cwd stays
 * Node-equal: bare relative, `./`, `../`-back-into-self, and nested `../`
 * collapse, plus `readdirSync` on relative dirs.
 *
 * Harness note: this case runs at the default cwd `/`; the non-root-cwd branch
 * is parity-covered by `relative-cwd-nonroot.case.ts` (via `ParityCase.cwd`)
 * and unit-covered by `packages/runtime-js/src/builtins/fs.test.ts`.
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
