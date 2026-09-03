import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/shadow-const.js': `
        const console = { marker: 'const' };
        process.stdout.write(console.marker);
      `,
      'project/shadow-let.js': `
        let console = { marker: 'let' };
        process.stdout.write(console.marker);
      `,
      'project/shadow-var.js': `
        var console = { marker: 'var' };
        process.stdout.write(console.marker);
      `,
      'project/function-body.js': `
        process.stdout.write(JSON.stringify({
          thisIsObject: this !== null && typeof this === 'object',
          argumentsTag: Object.prototype.toString.call(arguments),
          hasArguments: arguments.length > 0,
        }));
        return;
        process.stdout.write('unreachable');
      `,
      'project/strict-function-body.js': `
        'use strict';
        process.stdout.write(JSON.stringify({
          strictNestedThis: (function () { return this; })() === undefined,
          argumentsTag: Object.prototype.toString.call(arguments),
        }));
        return;
        process.stdout.write('unreachable');
      `,
      'project/malformed.js': `
        }
        return function () {
      `,
    },
  },
  code: `
    const { spawn } = require('node:child_process');
    function run(file) {
      return new Promise((resolve) => {
        const child = spawn('node', [file], { stdio: 'pipe' });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('close', (code, signal) => {
          resolve({ code, signal, stdout, syntaxError: stderr.includes('SyntaxError') });
        });
      });
    }
    Promise.all([
      run('shadow-const.js'),
      run('shadow-let.js'),
      run('shadow-var.js'),
      run('function-body.js'),
      run('strict-function-body.js'),
      run('malformed.js'),
    ]).then(([constant, lexical, variable, body, strictBody, malformed]) => {
      console.log(JSON.stringify({ constant, lexical, variable, body, strictBody, malformed }));
    });
  `,
  expected:
    '{"constant":{"code":0,"signal":null,"stdout":"const","syntaxError":false},' +
    '"lexical":{"code":0,"signal":null,"stdout":"let","syntaxError":false},' +
    '"variable":{"code":0,"signal":null,"stdout":"var","syntaxError":false},' +
    '"body":{"code":0,"signal":null,"stdout":"{\\"thisIsObject\\":true,\\"argumentsTag\\":\\"[object Arguments]\\",\\"hasArguments\\":true}","syntaxError":false},' +
    '"strictBody":{"code":0,"signal":null,"stdout":"{\\"strictNestedThis\\":true,\\"argumentsTag\\":\\"[object Arguments]\\"}","syntaxError":false},' +
    '"malformed":{"code":1,"signal":null,"stdout":"","syntaxError":true}}',
} satisfies ParityCase;
