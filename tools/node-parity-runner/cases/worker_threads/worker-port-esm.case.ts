import type { ParityCase } from '../../src/types.ts';

// ADR-0446 in ESM worker realms (vitest's pool workers `import { parentPort }`):
// an off()'d listener lets the worker drain ('exit' 0); vitest's threads
// teardown (`removeAllListeners('message')`) keeps it referenced until the
// parent's terminate() 400 ms after the reply ('exit' 1); natural exit reads
// `process.exitCode` and ignores a reassigned `process.exit`; `close()`
// releases a listened port. Rows print after the last 'exit'.
const port = "import { parentPort } from 'node:worker_threads';\n";
const c: ParityCase = {
  setup: {
    files: {
      'w-off.mjs': `${port}const on = (message) => {
  parentPort.postMessage('echo:' + message);
  parentPort.off('message', on);
};
parentPort.on('message', on);
`,
      'w-teardown.mjs': `${port}parentPort.on('message', (message) => {
  parentPort.postMessage('echo:' + message);
  parentPort.removeAllListeners('message');
});
`,
      'w-exit.mjs': `${port}process.exitCode = 2;
process.exit = () => { throw new Error('patched process.exit called'); };
setTimeout(() => parentPort.postMessage('tick'), 50);
`,
      'w-close.mjs': `${port}parentPort.on('message', () => {});
parentPort.postMessage('before-close');
parentPort.close();
`,
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const run = (file, post, terminateMs) =>
      new Promise((done) => {
        const worker = new Worker(resolve(file));
        const rows = [];
        worker.on('message', (message) => {
          rows.push('message:' + message);
          if (terminateMs === undefined) return;
          setTimeout(() => worker.terminate().then((code) => rows.push('terminate:' + code)), terminateMs);
        });
        worker.on('error', (error) => rows.push('error:' + error.message));
        worker.on('online', () => {
          if (post !== undefined) worker.postMessage(post);
        });
        worker.on('exit', (code) => {
          rows.push('exit:' + code);
          setTimeout(() => done(file + ' ' + rows.join(' ')), 0);
        });
      });
    Promise.all([
      run('w-off.mjs', 'a'),
      run('w-teardown.mjs', 'a', 400),
      run('w-exit.mjs'),
      run('w-close.mjs'),
    ]).then((rows) => console.log(rows.join('\\n')));
  `,
  expected:
    'w-off.mjs message:echo:a exit:0\n' +
    'w-teardown.mjs message:echo:a exit:1 terminate:1\n' +
    'w-exit.mjs message:tick exit:2\n' +
    'w-close.mjs message:before-close exit:0\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 4,
};

export default c;
