/**
 * `spawn('node', ['dir/file.js'])` and `fork('dir/file.js')` resolve the entry
 * against the CHILD cwd, and expose the resolved absolute path as argv[1].
 * A bare path containing `/` is still a file entry — never a package specifier.
 */
import type { ParityCase } from '../../src/types.ts';

const childSource = (label: string, suffix: string): string => `
  const childProcess = typeof __process === 'undefined' ? process : __process;
  const write = typeof __stdout_write === 'undefined'
    ? (chunk) => process.stdout.write(chunk)
    : __stdout_write;
  write('${label}:' + childProcess.argv[1].startsWith('/') + ':' + childProcess.argv[1].endsWith('${suffix}'));
`;

const c: ParityCase = {
  cwd: '/project',
  setup: {
    files: {
      'project/nested/spawn.js': childSource('spawn', '/nested/spawn.js'),
      'project/nested/fork.js': childSource('fork', '/nested/fork.js'),
    },
  },
  code: `
    const { fork, spawn } = require('node:child_process');
    const childCwd = require('node:process').cwd();

    function output(child) {
      return new Promise((resolve, reject) => {
        let text = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { text += chunk.toString(); });
        child.stdout.on('error', reject);
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.stderr.on('error', reject);
        child.on('close', () => queueMicrotask(() => resolve(stderr === '' ? text : 'ERR:' + stderr)));
      });
    }

    Promise.all([
      output(spawn('node', ['nested/spawn.js'], { cwd: childCwd })),
      output(fork('nested/fork.js', [], { cwd: childCwd, silent: true })),
    ]).then((lines) => console.log(lines.join('|')));
  `,
  expected: 'spawn:true:true|fork:true:true',
};

export default c;
