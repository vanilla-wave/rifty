import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/shadow.js': `
        const console = { marker: 'shadow' };
        process.stdout.write(console.marker);
      `,
    },
  },
  code: `
    const { spawn } = require('node:child_process');
    const child = spawn('node', ['shadow.js'], { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code, signal) => {
      console.log(JSON.stringify({ code, signal, stdout, stderr }));
    });
  `,
  expected: '{"code":0,"signal":null,"stdout":"shadow","stderr":""}',
} satisfies ParityCase;
