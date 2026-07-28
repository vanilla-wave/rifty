import type { ParityCase } from '../../src/types.ts';
export default {
  setup: { files: { 'parent/child.js': "process.stdout.write('sibling-ran'); process.exit(0);" } },
  cwd: '/project',
  code: `const { spawn } = require('node:child_process'); const { resolve } = require('node:path'); process.argv[1] = resolve('../parent/main.js'); const child = spawn('node', ['child.js'], { cwd: process.cwd() }); let stdout = ''; child.stdout.on('data', (chunk) => { stdout += chunk.toString(); }); child.once('close', () => console.log(stdout === '' ? 'missing' : 'sibling-ran'));`,
  expected: 'missing\n',
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
} satisfies ParityCase;
