/**
 * Advanced fork IPC at the process boundary (ADR-0448 fault matrix): a message
 * is fixed at `send()` (later writes, including through a SharedArrayBuffer,
 * never reach the peer), a refused send posts nothing and keeps order, and a
 * child that ends or crashes after sending delivers what it sent, then
 * 'disconnect', then 'exit'.
 */
import type { ParityCase } from '../../src/types.ts';
import { DESCRIBE_SOURCE, ECHO_CHILD_SOURCE } from './advanced-ipc-program.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 3,
  cwd: '/project',
  setup: {
    files: {
      'project/echo.cjs': ECHO_CHILD_SOURCE,
      'project/burst.cjs': `
        const process = require('node:process');
        const { Buffer } = require('node:buffer');
        process.send({ n: 1, u: undefined });
        process.send({ n: 2, b: Buffer.from('burst') });
        process.send([3, new Map([['k', 'v']])]);
      `,
      'project/crash.cjs': `
        const process = require('node:process');
        const { Buffer } = require('node:buffer');
        process.send({ a: 1, u: undefined });
        process.send({ b: Buffer.from('x') });
        setTimeout(() => { throw new Error('boom'); }, 0);
      `,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const { Buffer } = require('node:buffer');
    const cwd = require('node:process').cwd();
    ${DESCRIBE_SOURCE}
    const rows = [];
    const row = (label, value) => rows.push(label + ' ' + JSON.stringify(value));

    function lifecycle(file) {
      return new Promise((resolve) => {
        const events = [];
        const child = fork(file, [], { cwd, serialization: 'advanced', stdio: 'pipe' });
        child.stderr.resume();
        child.on('error', () => {});
        child.on('message', (message) => events.push(['message', describe(message)]));
        child.on('disconnect', () => events.push(['disconnect', child.connected]));
        child.on('exit', (code, signal) => {
          events.push(['exit', code, signal]);
          resolve({ events, sendAfterExit: child.send({ late: true }) });
        });
      });
    }

    void (async () => {
      const child = fork('echo.cjs', [], { cwd, serialization: 'advanced', stdio: 'pipe' });
      const replies = [];
      let settle = () => {};
      child.on('message', (message) => {
        replies.push([message.label, message.childSaw]);
        if (message.label === 'last') settle();
      });
      const done = new Promise((resolve) => { settle = resolve; });

      const record = { list: [1, 2], nested: { k: 'v' } };
      child.send({ label: 'mutated-after-send', value: record });
      record.list.push(3);
      record.nested.k = 'changed';

      const shared = new Uint8Array(new SharedArrayBuffer(3));
      shared.set([1, 2, 3]);
      child.send({ label: 'shared-view-written-after-send', value: shared });
      shared.set([9, 9, 9]);

      const buffer = Buffer.from('keep');
      child.send({ label: 'buffer-written-after-send', value: { buffer } });
      buffer.write('lost');

      child.send({ label: 'before-refusal', value: 1 });
      let refusal = null;
      try {
        child.send({ label: 'refused', value: { fn() {} } });
      } catch (error) {
        refusal = errorShape(error);
      }
      child.send({ label: 'last', value: 2 });
      await done;
      row('echo-replies', replies);
      row('refusal', refusal);
      const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
      child.disconnect();
      row('echo-exit', await exited);

      row('burst-then-natural-exit', await lifecycle('burst.cjs'));
      row('crash-after-send', await lifecycle('crash.cjs'));

      console.log(rows.join('\\n'));
    })().catch((error) => {
      console.log('case-error:' + error.name + ':' + error.message);
    });
  `,
};

export default c;
