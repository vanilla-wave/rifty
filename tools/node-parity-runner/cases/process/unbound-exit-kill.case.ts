/**
 * `this`-dependent process members work detached from `process`, as a named
 * import calls them: a forked child's exit code / self-signal match Node.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 2,
  cwd: '/project',
  setup: {
    files: {
      'project/unbound-exit.js': `
        const { exit } = require('node:process');
        exit(3);
      `,
      'project/unbound-kill.js': `
        const { kill } = require('node:process');
        setInterval(() => {}, 1000);
        kill(require('node:process').pid, 'SIGUSR2');
      `,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const run = (file) => new Promise((resolve) => {
      const child = fork(file, [], { cwd, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stderr = '';
      child.stdout.resume();
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('close', (code, signal) => resolve({ file, code, signal, stderr: stderr.length > 0 }));
    });
    (async () => {
      console.log(JSON.stringify(await run('unbound-exit.js')));
      console.log(JSON.stringify(await run('unbound-kill.js')));
    })();
  `,
};

export default c;
