/** Node child-process IPC defaults to JSON serialization in both directions. */
import type { ParityCase } from '../../src/types.ts';

const childSource = `
  const p = typeof __process === 'undefined' ? process : __process;
  p.send({ side: 'child', keep: 1, drop() {} });
`;

const c: ParityCase = {
  setup: { files: { 'ipc-child.js': childSource } },
  code: `
    const { fork } = require('node:child_process');
    const child = fork('ipc-child.js', [], { cwd: require('node:process').cwd() });
    child.on('message', (message) => {
      console.log('child:' + Object.keys(message).sort().join(','));
    });
  `,
  expected: 'child:keep,side',
};

export default c;
