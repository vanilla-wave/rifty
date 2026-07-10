/** A failed default-JSON IPC send never poisons the child-process channel. */
import type { ParityCase } from '../../src/types.ts';

const childSource = `
  const p = typeof __process === 'undefined' ? process : __process;
  const circular = {};
  circular.self = circular;
  let circularThrew = false;
  try {
    p.send(circular);
  } catch (error) {
    circularThrew = /circular/i.test(String(error && error.message));
  }
  p.send({ circularThrew, after: 'connected' });
`;

const c: ParityCase = {
  cwd: '/project',
  setup: { files: { 'project/ipc-survival-child.js': childSource } },
  code: `
    const { fork } = require('node:child_process');
    const childCwd = require('node:process').cwd();
    const child = fork('ipc-survival-child.js', [], { cwd: childCwd });
    child.on('message', (message) => {
      console.log('circular:' + message.circularThrew + '|after:' + message.after);
      child.kill();
    });
  `,
  expected: 'circular:true|after:connected',
};

export default c;
