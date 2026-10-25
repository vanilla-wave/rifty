import type { ParityCase } from '../../src/types.ts';

// ADR-0446: a worker realm exits when its loop drains, as a Node program does
// (ADR-0445 rule 6): messages posted before the end arrive before 'exit', the
// code is `process.exitCode ?? 0`, the worker's own 'exit' listeners run, and a
// reassigned `process.exit` is not what ends it. After 'exit' the Worker holds
// nothing (both reference objects are null). The four Workers run at once and
// their rows print after the last 'exit': only the live Workers hold the
// parent, no timer or terminate() does.
const c: ParityCase = {
  setup: {
    files: {
      'w-return.cjs':
        "const { parentPort } = require('node:worker_threads');\n" +
        "parentPort.postMessage('first');\n" +
        "parentPort.postMessage('second');\n",
      'w-exit-code.cjs':
        "const { parentPort } = require('node:worker_threads');\n" +
        'process.exitCode = 3;\n' +
        "setTimeout(() => parentPort.postMessage('after-timer'), 100);\n",
      'w-exit-call.cjs':
        "const { parentPort } = require('node:worker_threads');\n" +
        "setTimeout(() => { parentPort.postMessage('before-exit'); process.exit(5); }, 100);\n",
      'w-patched-exit.cjs':
        "const { parentPort } = require('node:worker_threads');\n" +
        "process.on('exit', (code) => parentPort.postMessage('worker exit event ' + code));\n" +
        "process.exit = () => { throw new Error('patched process.exit called'); };\n" +
        "setTimeout(() => parentPort.postMessage('tick'), 100);\n",
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const run = (file, onExit) =>
      new Promise((done) => {
        const worker = new Worker(resolve(file));
        const rows = [];
        worker.on('message', (message) => rows.push('message:' + message));
        worker.on('error', (error) => rows.push('error:' + error.message));
        worker.on('exit', (code) => {
          rows.push('exit:' + code);
          if (onExit) rows.push(onExit(worker));
          done(file + ' ' + rows.join(' '));
        });
      });
    const afterExit = (worker) => {
      const symbols = Object.getOwnPropertySymbols(worker);
      const kHandle = symbols.find((s) => s.toString().includes('kHandle'));
      const kPublicPort = symbols.find((s) => s.toString().includes('kPublicPort'));
      return (
        'after-exit:' +
        [kHandle && worker[kHandle], kPublicPort && worker[kPublicPort], worker.ref(), worker.unref()]
          .map(String)
          .join(',')
      );
    };
    Promise.all([
      run('w-return.cjs', afterExit),
      run('w-exit-code.cjs'),
      run('w-exit-call.cjs'),
      run('w-patched-exit.cjs'),
    ]).then((rows) => console.log(rows.join('\\n')));
  `,
  expected:
    'w-return.cjs message:first message:second exit:0 after-exit:null,null,undefined,undefined\n' +
    'w-exit-code.cjs message:after-timer exit:3\n' +
    'w-exit-call.cjs message:before-exit exit:5\n' +
    'w-patched-exit.cjs message:tick message:worker exit event 0 exit:0\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 4,
};

export default c;
