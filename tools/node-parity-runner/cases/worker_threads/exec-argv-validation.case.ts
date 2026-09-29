import type { ParityCase } from '../../src/types.ts';
import { startupFilesUnder } from '../process/startup-options-program.ts';

// ADR-0449 §2: Worker `execArgv` validation as in Node — a truthy non-array is
// `ERR_INVALID_ARG_TYPE`; a supported flag without its operand (end of the
// array, a following `-` token, or an empty `=` value) is
// `ERR_WORKER_INVALID_EXEC_ARGV`, both thrown by the constructor. A preload that
// cannot be found ends the worker with exit code 1 (its 'error' event is the
// separate kernel-error gap, so only the code is compared here).
const c: ParityCase = {
  cwd: '/project',
  setup: { files: startupFilesUnder('project') },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const invalid = [
      'str',
      {},
      ['--require'],
      ['-C', '-r', './pre.cjs'],
      ['--conditions', '-'],
      ['--conditions='],
      ['--require=', 'x'],
    ];
    for (const execArgv of invalid) {
      try {
        new Worker(resolve('probe.cjs'), { execArgv });
        console.log(JSON.stringify(execArgv), 'constructed');
      } catch (error) {
        console.log(JSON.stringify(execArgv), error.name, error.code, error.message);
      }
    }
    try {
      const worker = new Worker(resolve('probe.cjs'), { execArgv: ['--require', './missing.cjs'] });
      worker.on('error', () => {});
      worker.on('message', () => console.log('missing-preload message'));
      worker.on('exit', (code) => console.log('missing-preload exit', code));
    } catch (error) {
      console.log('missing-preload', error.name, error.message);
    }
  `,
  expected:
    '"str" TypeError ERR_INVALID_ARG_TYPE The "options.execArgv" property must be an instance of Array. Received type string (\'str\')\n' +
    '{} TypeError ERR_INVALID_ARG_TYPE The "options.execArgv" property must be an instance of Array. Received an instance of Object\n' +
    '["--require"] Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --require requires an argument\n' +
    '["-C","-r","./pre.cjs"] Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: -C requires an argument\n' +
    '["--conditions","-"] Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --conditions requires an argument\n' +
    '["--conditions="] Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --conditions= requires an argument\n' +
    '["--require=","x"] Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --require= requires an argument\n' +
    'missing-preload exit 1\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 1,
};

export default c;
