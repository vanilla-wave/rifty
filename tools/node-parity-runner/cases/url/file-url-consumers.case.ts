import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'a/b.js': ';\n',
      'value.cjs': 'module.exports = 42;\n',
    },
  },
  code: `
    const { readFileSync } = require('node:fs');
    const { createRequire } = require('node:module');
    const { pathToFileURL } = require('node:url');
    const { Worker } = require('node:worker_threads');

    const base = pathToFileURL('./');
    const encodedSlash = new URL('a%2Fb.js', base);
    const capture = (label, action) => {
      try {
        const value = action();
        if (value && typeof value.terminate === 'function') void value.terminate();
        console.log(label + ':LOADED');
      } catch (error) {
        console.log(label + ':' + error.code);
      }
    };

    capture('fs', () => readFileSync(encodedSlash));
    capture('module', () => createRequire(encodedSlash));
    const mixedCaseBase = pathToFileURL(__filename).href.replace(/^file:/, 'FiLe:');
    capture('module-case', () => createRequire(mixedCaseBase)('./value.cjs'));
    console.warn = () => {};
    capture('worker', () => new Worker(encodedSlash));
  `,
  expected: [
    'fs:ERR_INVALID_FILE_URL_PATH',
    'module:ERR_INVALID_ARG_VALUE',
    'module-case:LOADED',
    'worker:ERR_INVALID_FILE_URL_PATH',
    '',
  ].join('\n'),
};

export default c;
