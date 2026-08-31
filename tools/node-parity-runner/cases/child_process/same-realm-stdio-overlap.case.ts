import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/a.js': `
        const plain = require('console');
        const node = require('node:console');
        setTimeout(() => {
          console.log('A-global', { child: 1 });
          plain.log('A-plain', console === plain, plain === node);
          node.error('A-node');
        }, 10);
      `,
      'project/b.js': `
        const plain = require('console');
        const node = require('node:console');
        globalThis[Symbol.unscopables] = { console: true };
        setTimeout(() => {
          console.log('B-global', { child: 2 });
          plain.log('B-plain', console === plain, plain === node);
          node.error('B-node');
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
    '{"a":{"code":0,"signal":null,"stdout":"A-global { child: 1 }\\nA-plain true true\\n","stderr":"A-node\\n"},' +
    '"b":{"code":0,"signal":null,"stdout":"B-global { child: 2 }\\nB-plain true true\\n","stderr":"B-node\\n"},' +
    '"ownerFrames":[]}',
} satisfies ParityCase;
