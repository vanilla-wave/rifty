/**
 * A child's `Readable.pipe` leaves the parent's `node:process` alone: after the
 * child ran a pipe, the parent's `require('node:process')` is still its own
 * process (identity, pid, `exitCode` writes) and its `pipe(process.stdout)`
 * still never ends stdout. Seeded mode: rifty spawns a same-realm child here,
 * which swaps the active process while the child runs — a pipe read that
 * cached the `node:process` registry entry pinned the child's process.
 */
import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/child.js': `
        const { Readable, Writable } = require('stream');
        Readable.from(['x']).pipe(new Writable({ write(_c, _e, cb) { cb(); } }));
        process.stdout.write('child piped\\n');
      `,
    },
  },
  code: `
    const { Readable } = require('node:stream');
    const { spawn } = require('node:child_process');
    const child = spawn('node', ['child.js'], { stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('close', (code) => {
      const p = require('node:process');
      p.exitCode = 3;
      const exitCode = process.exitCode;
      process.exitCode = 0;
      console.log(JSON.stringify(out) + ' close ' + code + '; require(node:process) === process ' +
        (p === process) + '; pid match ' + (p.pid === process.pid) + '; exitCode via require ' + exitCode);
      const src = Readable.from(['parent piped\\n']);
      src.pipe(process.stdout);
      src.once('end', () => setImmediate(() => {
        process.stdout.write('parent stdout still writable\\n');
        process.stdin.resume();
      }));
    });
  `,
  expected: [
    '"child piped\\n" close 0; require(node:process) === process true; pid match true; exitCode via require 3',
    'parent piped',
    'parent stdout still writable',
  ].join('\n'),
} satisfies ParityCase;
