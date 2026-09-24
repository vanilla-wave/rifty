import type { ParityCase } from '../../src/types.ts';

// ADR-0446: a referenced `parentPort` keeps its worker alive: an on() or
// onmessage listener, a bare ref(), or a listener whose removal went through
// removeAllListeners() (no unreference in Node — vitest's threads-pool
// teardown). The parent's terminate() 400 ms after the first reply then ends a
// still-live worker: 'exit' 1 and terminate() resolves 1. A worker that had
// drained would report 'exit' 0 before the timer. Drain cases:
// worker-port-reference.case.ts.
const port = "const { parentPort } = require('node:worker_threads');\n";
const c: ParityCase = {
  setup: {
    files: {
      'w-on.cjs': `${port}parentPort.on('message', (message) => parentPort.postMessage('echo:' + message));\n`,
      'w-onmessage.cjs': `${port}parentPort.onmessage = (event) => parentPort.postMessage('echo:' + event.data);\n`,
      'w-ref.cjs': `${port}parentPort.ref();\nparentPort.postMessage('ready');\n`,
      'w-remove-all.cjs': `${port}parentPort.on('message', (message) => {
  parentPort.postMessage('echo:' + message);
  parentPort.removeAllListeners('message');
});
`,
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const run = (file, post) =>
      new Promise((done) => {
        const worker = new Worker(resolve(file));
        const rows = [];
        let replied = false;
        worker.on('message', (message) => {
          rows.push('message:' + message);
          if (replied) return;
          replied = true;
          setTimeout(() => worker.terminate().then((code) => rows.push('terminate:' + code)), 400);
        });
        worker.on('online', () => {
          if (post !== undefined) worker.postMessage(post);
        });
        worker.on('exit', (code) => {
          rows.push('exit:' + code);
          setTimeout(() => done(file + ' ' + rows.join(' ')), 0);
        });
      });
    Promise.all([
      run('w-on.cjs', 'a'),
      run('w-onmessage.cjs', 'a'),
      run('w-ref.cjs'),
      run('w-remove-all.cjs', 'a'),
    ]).then((rows) => console.log(rows.join('\\n')));
  `,
  expected:
    'w-on.cjs message:echo:a exit:1 terminate:1\n' +
    'w-onmessage.cjs message:echo:a exit:1 terminate:1\n' +
    'w-ref.cjs message:ready exit:1 terminate:1\n' +
    'w-remove-all.cjs message:echo:a exit:1 terminate:1\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 4,
};

export default c;
