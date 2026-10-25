/**
 * ADR-0445 / I3: a physical forked program child honours Node's `exit()` /
 * `exitCode` / `'exit'` event contract (unset `exitCode` reads `undefined`,
 * `exit()` without an argument uses it, one emission, listener mutation and
 * re-entry, no timer after `'exit'`) and its nextTick throw dispatch.
 */
import type { ParityCase } from '../../src/types.ts';

// Children write their own stdout (string rows, no console colouring).
const OUT = "const out = (s) => process.stdout.write(s + '\\n');";
const EXIT_ROW = "process.on('exit', (c) => out('exit ' + c + ' ' + process.exitCode));";

const children: Readonly<Record<string, string>> = {
  'natural.js': `${EXIT_ROW}\nout('body ' + typeof process.exitCode);`,
  'natural-code.js': `${EXIT_ROW}\nsetTimeout(() => { process.exitCode = 4; out('late'); }, 10);`,
  'exitcode-read.js': `out('initial ' + typeof process.exitCode);
process.exitCode = '3';
out('string ' + typeof process.exitCode + ' ' + process.exitCode);
process.exitCode = null;
out('null ' + (process.exitCode === null ? 'null' : typeof process.exitCode));
process.exitCode = 4;
process.exitCode = undefined;
out('reset ' + typeof process.exitCode);`,
  'exit-no-arg.js': `${EXIT_ROW}\nprocess.exitCode = 3;\nprocess.exit();`,
  'exit-startup-error.js': `${EXIT_ROW}\nif (process.exitCode == null) process.exitCode = 1;\nprocess.exit();`,
  'exit-undefined-arg.js': `${EXIT_ROW}\nprocess.exitCode = 3;\nprocess.exit(undefined);`,
  'exit-arg-override.js': `${EXIT_ROW}\nprocess.exitCode = 9;\nprocess.exit(5);`,
  'exit-listener-reassign.js': `process.on('exit', (c) => { out('exit ' + c); process.exitCode = 5; });
process.on('exit', (c) => out('exit-b ' + c + ' ' + process.exitCode));`,
  'exit-reentrant.js': `let n = 0;
process.on('exit', (c) => { n += 1; out('exit ' + c + ' ' + n); process.exit(2); });
process.on('exit', (c) => out('exit-b ' + c));
process.exit(1);`,
  'exit-listener-timer.js': `process.on('exit', (c) => {
  out('exit ' + c + ' ' + process.exitCode);
  setTimeout(() => { out('timer-in-exit'); process.exit(9); }, 0);
});
setTimeout(() => out('done'), 5);`,
  'nexttick-handler.js': `${EXIT_ROW}
process.on('uncaughtException', (e, o) => out('caught ' + e.message + ' ' + o));
process.nextTick(() => { throw new Error('tick'); });
setTimeout(() => out('after'), 20);`,
  'nexttick-fatal.js': `${EXIT_ROW}
process.nextTick(() => { throw new Error('FATAL-TICK'); });
setTimeout(() => out('never'), 20);`,
};

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: Object.keys(children).length,
  cwd: '/project',
  setup: {
    files: Object.fromEntries(
      Object.entries(children).map(([name, source]) => [`project/${name}`, `${OUT}\n${source}`]),
    ),
  },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const files = ${JSON.stringify(Object.keys(children))};
    const run = (file) => new Promise((resolve) => {
      const child = fork(file, [], { cwd, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('close', (code, signal) => resolve({
        file,
        stdout: stdout.split('\\n').filter(Boolean),
        code,
        signal,
        loud: stderr.includes('FATAL'),
      }));
    });
    (async () => {
      for (const file of files) console.log(JSON.stringify(await run(file)));
    })();
  `,
};

export default c;
