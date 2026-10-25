/**
 * vitest's forks-pool shape (cli-api `this._fork.stdout.pipe(this.stdout)`,
 * `this.stdout` defaulting to `process.stdout`): a forked child's stdout and
 * stderr piped into the parent's process streams. When the child's streams end,
 * the parent's process streams are not ended — the parent keeps writing after
 * the child closes, as the reporter does after a pool worker exits.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/child.js': `
        process.stdout.write('child stdout line\\n');
        process.stderr.write('child stderr line\\n');
      `,
    },
  },
  expected: 'child stdout line\nchild closed 0; parent stdout still writable',
  code: `
    const { fork } = require('node:child_process');
    const process = require('node:process');
    const child = fork('child.js', [], { cwd: process.cwd(), stdio: 'pipe' });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on('close', (code) => {
      setImmediate(() => {
        process.stderr.write('parent stderr still writable\\n');
        process.stdout.write('child closed ' + code + '; parent stdout still writable\\n');
      });
    });
  `,
};

export default c;
