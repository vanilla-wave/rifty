import type { ParityCase } from '../../src/types.ts';

// ADR-0449 §1: every Worker has `stdout`/`stderr` Readables (`stdin` is null
// without `stdin: true`). By default the worker's output is piped into the
// parent's process streams and lands before the parent's 'exit' row; with
// `stdout: true` / `stderr: true` it is captured on the streams only, and a
// captured stream nobody reads holds nothing. vitest's
// threads pool: `new Worker(entry, { env, execArgv, stdout: true, stderr: true })`
// then `thread.stdout.pipe(...)`.
const c: ParityCase = {
  setup: {
    files: {
      'w-log.cjs':
        "require('node:worker_threads');\n" +
        "console.log('from-worker');\n" +
        "process.stdout.write('raw-out\\n');\n" +
        "console.error('err-worker');\n",
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { Readable } = require('node:stream');
    const { resolve } = require('node:path');
    const runDefault = () =>
      new Promise((done) => {
        const worker = new Worker(resolve('w-log.cjs'));
        console.log(
          'default',
          worker.stdout instanceof Readable,
          worker.stderr instanceof Readable,
          worker.stdin,
          worker.stdout === worker.stdout,
        );
        worker.on('exit', (code) => {
          console.log('default-exit', code);
          done();
        });
      });
    const runCapture = () =>
      new Promise((done) => {
        const worker = new Worker(resolve('w-log.cjs'), { stdout: true, stderr: true });
        console.log('capture', worker.stdout instanceof Readable, worker.stderr instanceof Readable, worker.stdin);
        let out = '';
        let err = '';
        // Guarded so a missing stream reads as a row diff, not a harness throw.
        worker.stdout?.on('data', (chunk) => { out += chunk; });
        worker.stderr?.on('data', (chunk) => { err += chunk; });
        worker.on('exit', (code) => {
          console.log('capture-exit', code, JSON.stringify(out), JSON.stringify(err));
          done();
        });
      });
    // Never read: the captured stream neither holds the parent nor delays 'exit'.
    const runUnread = () =>
      new Promise((done) => {
        const worker = new Worker(resolve('w-log.cjs'), { stdout: true, stderr: true });
        worker.on('exit', (code) => {
          console.log('unread-exit', code);
          done();
        });
      });
    runDefault().then(runCapture).then(runUnread);
  `,
  expected:
    'default true true null true\n' +
    'from-worker\n' +
    'raw-out\n' +
    'default-exit 0\n' +
    'capture true true null\n' +
    'capture-exit 0 "from-worker\\nraw-out\\n" "err-worker\\n"\n' +
    'unread-exit 0\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 3,
};

export default c;
