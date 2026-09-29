import type { ParityCase } from '../../src/types.ts';

// ADR-0446: after unref(), the first 'message' listener references the
// Worker's public port again (Node's setupPortReferencing), so the parent
// stays alive for the worker's message. A once() listener holds only until it
// fires: the second Worker's late2 never arrives, the parent exits first, as
// in Node. No 'exit' listener: with only the public port referenced, Node's
// 'exit' delivery depends on its loop timing (evidence §Unref'd port hold).
// Both Workers start at once; their first messages are 800 ms apart.
const post = (label: string, ms: number): string =>
  `setTimeout(() => parentPort.postMessage('${label}'), ${ms});\n`;
const port = "const { parentPort } = require('node:worker_threads');\n";
const c: ParityCase = {
  setup: {
    files: {
      'w-late.cjs': port + post('late', 300),
      'w-two.cjs': port + post('late1', 1100) + post('late2', 2400),
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const first = new Worker(resolve('w-late.cjs'));
    first.unref();
    first.on('message', (message) => console.log('first message', message));
    const second = new Worker(resolve('w-two.cjs'));
    second.unref();
    second.once('message', (message) => console.log('second message', message));
    console.log('start');
  `,
  expected: 'start\nfirst message late\nsecond message late1\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 2,
};

export default c;
