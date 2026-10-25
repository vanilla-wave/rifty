/**
 * ADR-0445 fault-class sweep: a throw from an async-API callback (fs, zlib,
 * `util.callbackify`) is an uncaught exception — `uncaughtException` with
 * origin `uncaughtException`, never an `unhandledRejection` — and the program
 * continues. One forked child per source, so rows carry no cross-source order.
 */
import type { ParityCase } from '../../src/types.ts';

const HEAD = `const out = (s) => process.stdout.write(s + '\\n');
process.on('exit', (c) => out('exit ' + c + ' ' + process.exitCode));
process.on('unhandledRejection', (r) => out('unhandled ' + (r && r.message)));
process.on('uncaughtException', (e, o) => out('caught ' + e.message + ' ' + o));
setTimeout(() => out('after'), 100);`;

const children: Readonly<Record<string, string>> = {
  'fs-stat.js': "require('node:fs').stat(__filename, () => { throw new Error('fs-stat'); });",
  'fs-read-file.js':
    "require('node:fs').readFile(__filename, () => { throw new Error('fs-read-file'); });",
  'callbackify.js':
    "require('node:util').callbackify(async () => 1)(() => { throw new Error('callbackify'); });",
  'zlib-gzip.js': "require('node:zlib').gzip('x', () => { throw new Error('zlib-gzip'); });",
};

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: Object.keys(children).length,
  cwd: '/project',
  setup: {
    files: Object.fromEntries(
      Object.entries(children).map(([name, source]) => [`project/${name}`, `${HEAD}\n${source}`]),
    ),
  },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const files = ${JSON.stringify(Object.keys(children))};
    const run = (file) => new Promise((resolve) => {
      const child = fork(file, [], { cwd, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stdout = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.resume();
      child.once('close', (code, signal) => resolve({
        file,
        stdout: stdout.split('\\n').filter(Boolean),
        code,
        signal,
      }));
    });
    (async () => {
      for (const file of files) console.log(JSON.stringify(await run(file)));
    })();
  `,
};

export default c;
