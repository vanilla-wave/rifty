import type { ParityCase } from '../../src/types.ts';

// runtime-js/worker-threads-stdio-streams-empty-exec-argv (I5): vitest's
// threads pool does `new Worker(entry, { env, execArgv: [], stdout: true,
// stderr: true })` then pipes `worker.stdout`. Node v24.16.0 oracle
// 2026-10-05: `typeof w.stdout === 'object'`, `.pipe` is a function, the
// worker's console output is captured from the stream.
const c: ParityCase = {
  kind: 'worker-env',
  expectedPhysicalWorkers: 1,
  setup: {
    files: {
      'worker-stdio-child.cjs': `
        const { parentPort } = require('node:worker_threads');
        console.log('from-worker');
        console.error('werr');
        parentPort.postMessage('m');
      `,
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');

    const worker = new Worker(resolve('worker-stdio-child.cjs'), {
      execArgv: [],
      stdout: true,
      stderr: true,
    });
    console.log('types', typeof worker.stdout, typeof worker.stderr, typeof worker.stdout.pipe);
    let out = '';
    let err = '';
    worker.stdout.on('data', (c) => { out += c; });
    worker.stderr.on('data', (c) => { err += c; });
    let exited = false;
    let outEnded = false;
    let errEnded = false;
    const maybeReport = () => {
      if (exited && outEnded && errEnded) {
        console.log('stdout', JSON.stringify(out), 'stderr', JSON.stringify(err));
      }
    };
    worker.stdout.on('end', () => { outEnded = true; maybeReport(); });
    worker.stderr.on('end', () => { errEnded = true; maybeReport(); });
    worker.on('message', () => {
      void worker.terminate();
    });
    worker.on('exit', () => {
      exited = true;
      maybeReport();
    });
  `,
  expected: 'types object object function\nstdout "from-worker\\n" stderr "werr\\n"\n',
};

export default c;
