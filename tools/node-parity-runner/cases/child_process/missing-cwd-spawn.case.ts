import type { ParityCase } from '../../src/types.ts';

/**
 * A spawn whose `cwd` does not exist never starts a process: Node reports the
 * failure asynchronously as ENOENT with no pid, and the entry is never read.
 * Running the program from a normalized-but-absent directory instead would let
 * a tool with a mistyped or computed cwd read and write the wrong files while
 * reporting success.
 */
const child = `process.stdout.write('child-ran');`;

export default {
  setup: { files: { 'child.js': child } },
  cwd: '/project',
  code: `
const { spawn } = require('node:child_process');
const child = spawn('node', ['child.js'], { cwd: '/project/definitely-absent' });
let stdout = '';
child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
const seen = [];
child.once('error', (error) => { seen.push(['error', error.code, child.pid === undefined]); });
child.once('close', (code, signal) => {
  seen.push(['close', code, signal]);
  console.log(JSON.stringify({ seen, stdout }));
});
`,
  expected: `{"seen":[["error","ENOENT",true],["close",-2,null]],"stdout":""}\n`,
  // No Worker may be constructed at all: a spawn that fails before the
  // process exists is not a physical-worker case.
  kind: 'cjs',
} satisfies ParityCase;
