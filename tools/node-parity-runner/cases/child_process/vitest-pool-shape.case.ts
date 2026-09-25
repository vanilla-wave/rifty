import type { ParityCase } from '../../src/types.ts';
import {
  VITEST_POOL_EXEC_ARGV_SOURCE,
  startupFilesUnder,
} from '../process/startup-options-program.ts';

// Goal I4/I6, ADR-0449: vitest 4.1.11's forks pool (cli-api `ForksPoolWorker.start`)
// runs `fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })`
// with its exact pool `execArgv` and pipes the child's stdout into
// `process.stdout`. The child starts with those options (suppress-warnings
// preloaded, `development` condition, import.meta.resolve parent) and its
// output arrives once, through the pipe.
const c: ParityCase = {
  cwd: '/project',
  setup: { files: startupFilesUnder('project') },
  code: `
    const { fork } = require('node:child_process');
    const { resolve } = require('node:path');
    const process = require('node:process');
    const execArgv = ${VITEST_POOL_EXEC_ARGV_SOURCE};
    const child = fork(resolve('pool-probe.mjs'), [], {
      env: process.env,
      execArgv,
      stdio: 'pipe',
      serialization: 'advanced',
    });
    process.stdout.setMaxListeners(1 + process.stdout.getMaxListeners());
    child.stdout.pipe(process.stdout);
    process.stderr.setMaxListeners(1 + process.stderr.getMaxListeners());
    child.stderr.pipe(process.stderr);
    child.on('exit', (code) =>
      setImmediate(() => {
        process.stdout.write('fork exit ' + code + '; parent stdout still writable\\n');
      }),
    );
  `,
  expected:
    'pool execArgv ["--experimental-import-meta-resolve","--require","<abs>/suppress-warnings.cjs","--conditions","node","--conditions","development"]\n' +
    'pool cpkg dev meta sub/a.mjs\n' +
    'pool warnings ["other warning"]\n' +
    'fork exit 0; parent stdout still writable\n',
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
};

export default c;
