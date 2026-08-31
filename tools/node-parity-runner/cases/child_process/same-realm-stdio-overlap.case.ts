import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/a.js': `
        setTimeout(() => {
          console.log('A', { child: 1 });
          console.error('AE');
        }, 10);
      `,
      'project/b.js': `
        setTimeout(() => {
          console.log('B', { child: 2 });
          console.error('BE');
        }, 0);
      `,
    },
  },
  code: `
    const { spawn } = require('node:child_process');
    const ownerFrames = [];
    const ownerMethods = ['log', 'info', 'debug', 'warn', 'error'];
    const savedOwnerConsole = Object.fromEntries(
      ownerMethods.map((method) => [method, console[method]]),
    );
    for (const method of ownerMethods) {
      console[method] = (...args) => { ownerFrames.push([method, ...args]); };
    }
    function run(file) {
      return new Promise((resolve) => {
        const child = spawn('node', [file], { stdio: 'pipe' });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
      });
    }
    Promise.all([run('a.js'), run('b.js')]).then(([a, b]) => {
      for (const method of ownerMethods) console[method] = savedOwnerConsole[method];
      console.log(JSON.stringify({ a, b, ownerFrames }));
    });
  `,
  expected:
    '{"a":{"code":0,"signal":null,"stdout":"A { child: 1 }\\n","stderr":"AE\\n"},' +
    '"b":{"code":0,"signal":null,"stdout":"B { child: 2 }\\n","stderr":"BE\\n"},' +
    '"ownerFrames":[]}',
} satisfies ParityCase;
