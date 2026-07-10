/** Public ChildProcess stdio properties reflect pipe vs forwarded destinations. */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: { files: { 'stdio-shape-child.js': 'setInterval(() => {}, 1_000);' } },
  code: `
    const { fork, spawn } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const shape = (child) => [child.stdin, child.stdout, child.stderr]
      .map((stream) => stream === null ? 'null' : 'pipe')
      .join(',');

    const spawnInherited = spawn('node', ['stdio-shape-child.js'], { cwd, stdio: 'inherit' });
    const spawnTargeted = spawn('node', ['stdio-shape-child.js'], {
      cwd,
      stdio: ['pipe', process.stdout, process.stderr],
    });
    const forkDefault = fork('stdio-shape-child.js', [], { cwd });
    const forkSilent = fork('stdio-shape-child.js', [], { cwd, silent: true });

    console.log('spawn-inherit:' + shape(spawnInherited));
    console.log('spawn-target:' + shape(spawnTargeted));
    console.log('fork-default:' + shape(forkDefault));
    console.log('fork-silent:' + shape(forkSilent));
    for (const child of [spawnInherited, spawnTargeted, forkDefault, forkSilent]) child.kill();
  `,
  expected:
    'spawn-inherit:null,null,null\n' +
    'spawn-target:pipe,null,null\n' +
    'fork-default:null,null,null\n' +
    'fork-silent:pipe,pipe,pipe',
};

export default c;
