/**
 * A forked ESM child — the vitest forks-pool worker shape — links the named
 * `statfsSync` / `spawnSync` / `memoryUsage` imports and binds
 * `process.memoryUsage` at load (vitest 4.1.11 `chunks/init.k9zZ9sLh.js:197`),
 * so its kernel-seeded process carries the members too. Shape only; calls are
 * the rifty ceiling contract in `packages/runtime-js/src/builtins/loud-members.test.ts`.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/pool-worker.mjs': `
        import { statfsSync } from 'node:fs';
        import { spawnSync } from 'node:child_process';
        import process, { memoryUsage } from 'node:process';
        const bound = process.memoryUsage.bind(process);
        process.stdout.write(JSON.stringify([
          typeof statfsSync,
          typeof spawnSync,
          typeof memoryUsage,
          typeof bound,
          memoryUsage === process.memoryUsage,
        ]));
      `,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const child = fork('pool-worker.mjs', [], { cwd, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('close', (code, signal) => {
      console.log(JSON.stringify({ code, signal, stdout, stderr: stderr.length > 0 }));
    });
  `,
};

export default c;
