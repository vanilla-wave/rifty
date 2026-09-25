import type { ParityCase } from '../../src/types.ts';

// ADR-0449 §1 (Fault matrix `observable-order` rows): every chunk a worker wrote
// reaches its captured stream before the Worker's 'exit' — also when it writes a
// burst and calls `process.exit(3)`; the stream ends after 'exit' (`readableEnded`
// is false inside the 'exit' listener, true a tick later). `terminate()` in the
// middle of periodic output: 'exit' 1, then 'end'; the promise resolves 1.
const c: ParityCase = {
  setup: {
    files: {
      'w-burst.cjs':
        "require('node:worker_threads');\n" +
        "for (let i = 0; i < 1000; i++) process.stdout.write('line ' + i + '\\n');\n" +
        'process.exit(3);\n',
      'w-stream.cjs':
        "require('node:worker_threads');\n" +
        'let i = 0;\n' +
        "setInterval(() => process.stdout.write('tick ' + i++ + '\\n'), 5);\n",
    },
  },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const burst = () =>
      new Promise((done) => {
        const worker = new Worker(resolve('w-burst.cjs'), { stdout: true });
        const rows = [];
        let lines = 0;
        let last = '';
        worker.stdout?.on('data', (chunk) => {
          const text = last + chunk;
          const parts = text.split('\\n');
          last = parts.pop();
          lines += parts.length;
        });
        worker.stdout?.on('end', () => rows.push('end lines=' + lines));
        worker.on('exit', (code) => {
          rows.push('exit ' + code + ' lines=' + lines + ' ended=' + worker.stdout?.readableEnded);
          setImmediate(() => {
            rows.push('tick ended=' + worker.stdout?.readableEnded);
            done('burst ' + rows.join(' | '));
          });
        });
      });
    const terminateMidOutput = () =>
      new Promise((done) => {
        const worker = new Worker(resolve('w-stream.cjs'), { stdout: true });
        const rows = [];
        let chunks = 0;
        let resolved = 'pending';
        const stop = () => worker.terminate().then((code) => { resolved = String(code); });
        worker.stdout?.on('data', () => {
          chunks++;
          if (chunks === 3) stop();
        });
        worker.stdout?.on('end', () => rows.push('end'));
        // Node delivers three chunks within milliseconds of 'online'; the
        // fallback only stops a worker whose output never reaches the stream
        // (a row diff, not a hang).
        worker.on('online', () => setTimeout(() => { if (chunks < 3) stop(); }, 5000));
        worker.on('exit', (code) => {
          rows.push('exit ' + code);
          setTimeout(() => done('terminate ' + rows.join(' | ') + ' | chunks>=3=' + (chunks >= 3) + ' | resolved=' + resolved), 50);
        });
      });
    burst()
      .then((row) => console.log(row))
      .then(terminateMidOutput)
      .then((row) => console.log(row));
  `,
  expected:
    'burst exit 3 lines=1000 ended=false | end lines=1000 | tick ended=true\n' +
    'terminate exit 1 | end | chunks>=3=true | resolved=1\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 2,
};

export default c;
