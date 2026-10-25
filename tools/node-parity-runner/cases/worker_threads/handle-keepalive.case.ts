import type { ParityCase } from '../../src/types.ts';

// ADR-0446 / goal I2: a live Worker holds its parent. Nothing else keeps this
// program alive, so the late message and the Worker 'exit' arrive only if the
// Worker itself is a counted handle and its realm exits when its loop drains.
const c: ParityCase = {
  setup: {
    files: {
      'w-late.cjs':
        "const { parentPort } = require('node:worker_threads');\n" +
        "setTimeout(() => parentPort.postMessage('late'), 300);\n",
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const worker = new Worker(resolve('w-late.cjs'));
    worker.on('message', (message) => console.log('message', message));
    worker.on('exit', (code) => console.log('exit', code));
    console.log('start');
  `,
  expected: 'start\nmessage late\nexit 0\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 1,
};

export default c;
