import type { ParityCase } from '../../src/types.ts';

// Node creates stdio and the thread id before reading workerData, but env before both.
const c = {
  kind: 'worker-env',
  expectedPhysicalWorkers: 2,
  cwd: '/project',
  setup: {
    files: {
      'project/data.cjs': `
        const { parentPort, workerData } = require('node:worker_threads');
        parentPort.postMessage(workerData);
      `,
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const process = require('node:process');
    const counts = () => [process.stdout, process.stderr].map(stream =>
      ['error', 'close'].map(event => stream.listenerCount(event)));
    const before = counts();
    let inner;
    const outer = new Worker(resolve('data.cjs'), {
      get workerData() {
        const observed = counts().map((ns, i) => ns.map((n, j) => n - before[i][j]));
        inner = new Worker(resolve('data.cjs'), { workerData: 'inner' });
        return observed;
      },
    });
    const outerBeforeInner = outer.threadId < inner.threadId;
    const messages = {};
    for (const [label, worker] of [['outer', outer], ['inner', inner]]) {
      worker.on('message', value => {
        messages[label] = value;
        if (Object.keys(messages).length === 2) console.log('SX|worker-data ' + JSON.stringify({
          outerBeforeInner,
          data: messages.outer,
          inner: messages.inner,
        }));
      });
    }
  `,
  expected: 'SX|worker-data {"outerBeforeInner":true,"data":[[1,1],[1,1]],"inner":"inner"}\n',
} satisfies ParityCase;

export default c;
