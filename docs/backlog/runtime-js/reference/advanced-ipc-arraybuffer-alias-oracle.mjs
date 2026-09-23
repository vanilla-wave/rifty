import { runInNode } from '../../../../tools/node-parity-runner/src/run-in-node.ts';
import { runInRifty } from '../../../../tools/node-parity-runner/src/run-in-rifty.ts';

const testCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/child.js':
        "process.on('message',m=>{const before=m.view[0];new Uint8Array(m.backing)[2]=99;process.send({before,after:m.view[0],same:m.view.buffer===m.backing,offset:m.view.byteOffset,backingLength:m.view.buffer.byteLength});});",
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const child = fork('child.js', [], {
      cwd, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const backing = new ArrayBuffer(8);
    new Uint8Array(backing).set([0, 1, 2, 3, 4, 5, 6, 7]);
    const view = new Uint8Array(backing, 2, 3);
    child.once('message', (message) => {
      child.disconnect();
      child.once('exit', () => console.log(JSON.stringify(message)));
    });
    try {
      child.send({ backing, view });
    } catch (error) {
      child.disconnect();
      child.once('exit', () => console.log(JSON.stringify({
        error: error.name, feature: error.feature ?? null,
      })));
    }
  `,
};

console.log('node', JSON.stringify((await runInNode(testCase, { timeoutMs: 10000 })).trim()));
console.log('rifty', JSON.stringify((await runInRifty(testCase)).trim()));
process.exit(0);
