import type { ParityCase } from '../../src/types.ts';

// runtime-js/worker-threads-handle-keepalive (I2): a live Worker keeps the
// parent's loop alive (message at 700ms + exit event delivered, no other
// handle); unref() releases the hold (parent exits at its own 50ms timer);
// the ref releases at worker exit (parent drains promptly, no cap hang).
// Node v24.16.0 oracle 2026-10-05: same three phases, same output.
const c: ParityCase = {
  kind: 'worker-env',
  expectedPhysicalWorkers: 3,
  setup: {
    files: {
      'worker-keepalive-slow.cjs': `
        const { parentPort } = require('node:worker_threads');
        setTimeout(() => {
          parentPort.postMessage('hi');
          process.exit(0);
        }, 700);
      `,
      'worker-keepalive-fast.cjs': `
        const { parentPort } = require('node:worker_threads');
        setTimeout(() => {
          parentPort.postMessage('ok');
          process.exit(0);
        }, 20);
      `,
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');

    // Phase 1: the ONLY handle is the live worker — the loop must hold for it.
    const slow = new Worker(resolve('worker-keepalive-slow.cjs'));
    slow.on('message', (m) => console.log('got', m));
    slow.on('exit', (c) => {
      console.log('wexit', c);
      // Phase 2: unref'd worker must NOT hold the loop (no listener attached —
      // a 'message' listener re-refs the port in Node, out of this clause).
      const unrefd = new Worker(resolve('worker-keepalive-slow.cjs'));
      unrefd.unref();
      setTimeout(() => {
        console.log('parent-done');
        // Phase 3: ref releases at worker exit; parent drains promptly after.
        const fast = new Worker(resolve('worker-keepalive-fast.cjs'));
        fast.on('message', (m) => console.log('fast', m));
        fast.on('exit', () => console.log('all-done'));
      }, 50);
    });
  `,
  expected: 'got hi\nwexit 0\nparent-done\nfast ok\nall-done\n',
};

export default c;
