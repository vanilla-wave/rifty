import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/child.js': `
        const plain = require('console');
        const node = require('node:console');

        console.log('L', { a: 1 });
        console.info('I');
        console.debug('D');
        process.stdout.write('O1|');
        console.log('O2');
        process.stdout.write('O3\\n');

        process.stderr.write('R1|');
        console.warn('W');
        console.error('E');
        process.stderr.write('R2\\n');

        console.log(
          'identity',
          console === plain,
          plain === node,
          Object.hasOwn(plain, 'Console'),
          typeof plain.Console,
          plain.Console === node.Console,
          console instanceof plain.Console,
        );
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
    const child = spawn('node', ['child.js'], { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    const lifecycle = [];
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code, signal) => {
      lifecycle.push('exit:' + code + '/' + signal);
    });
    child.on('close', (code, signal) => {
      lifecycle.push('close:' + code + '/' + signal);
      for (const method of ownerMethods) console[method] = savedOwnerConsole[method];
      console.log(JSON.stringify({ stdout, stderr, lifecycle, ownerFrames }));
    });
  `,
  expected:
    '{"stdout":"L { a: 1 }\\nI\\nD\\nO1|O2\\nO3\\nidentity true true true function true true\\n",' +
    '"stderr":"R1|W\\nE\\nR2\\n",' +
    '"lifecycle":["exit:0/null","close:0/null"],"ownerFrames":[]}',
} satisfies ParityCase;
