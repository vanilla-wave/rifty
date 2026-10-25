import type { ParityCase } from '../../src/types.ts';
import {
  VITEST_POOL_EXEC_ARGV_SOURCE,
  startupFilesUnder,
} from '../process/startup-options-program.ts';

// Goal I5/I6, ADR-0449: vitest 4.1.11's threads pool (cli-api `ThreadsPoolWorker.start`)
// runs `new Worker(entry, { env, execArgv, stdout: true, stderr: true })` with its
// exact pool `execArgv` (`--experimental-import-meta-resolve`, `--require
// <root>/node_modules/vitest/suppress-warnings.cjs`, `--conditions node`,
// `--conditions development` for vite 8.0.16) and pipes `thread.stdout` into
// `process.stdout`. The worker's output arrives once, through the pipe; the
// preloaded suppress-warnings patch drops the VM Modules warning; the
// `development` condition selects the package target; import.meta.resolve
// honours its parent argument; after 'exit' vitest unpipes and the parent's
// stdout stays writable.
const c: ParityCase = {
  cwd: '/project',
  setup: { files: startupFilesUnder('project') },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const process = require('node:process');
    const execArgv = ${VITEST_POOL_EXEC_ARGV_SOURCE};
    let thread;
    try {
      thread = new Worker(resolve('pool-probe.mjs'), {
        env: process.env,
        execArgv,
        stdout: true,
        stderr: true,
      });
    } catch (error) {
      process.stdout.write('thread throw ' + error.name + ': ' + error.message + '\\n');
    }
    if (thread) {
      process.stdout.setMaxListeners(1 + process.stdout.getMaxListeners());
      thread.stdout?.pipe(process.stdout);
      process.stderr.setMaxListeners(1 + process.stderr.getMaxListeners());
      thread.stderr?.pipe(process.stderr);
      thread.on('error', (error) => console.log('thread error', error.name, error.message));
      thread.on('exit', (code) =>
        setImmediate(() => {
          thread.stdout?.unpipe(process.stdout);
          thread.stderr?.unpipe(process.stderr);
          process.stdout.write('thread exit ' + code + '; parent stdout still writable\\n');
        }),
      );
    }
  `,
  expected:
    'pool execArgv ["--experimental-import-meta-resolve","--require","<abs>/suppress-warnings.cjs","--conditions","node","--conditions","development"]\n' +
    'pool cpkg dev meta sub/a.mjs\n' +
    'pool warnings ["other warning"]\n' +
    'thread exit 0; parent stdout still writable\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 1,
};

export default c;
