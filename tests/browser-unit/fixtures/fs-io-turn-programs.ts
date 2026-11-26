import callbackTurnOrderCase from '../../../tools/node-parity-runner/cases/fs/callback-turn-order.case.ts';

// Unit runtime-js/fs-callbacks-io-turn: fs completions in their own loop turn, and the
// process lifecycle around operations in flight. Node v24.16.0: every printed row
// 20/20 (+80/80 under load). Not printed (Node varies): what a worker's file holds after
// `terminate()` with a write in flight (79/80 written), an op submitted from an `'exit'`
// listener of a natural exit (13/20 not written). Declared (`runtime-js/fs-async-op-io-rounds`):
// `writeFile` + `process.exit()` in the same tick — Node `""` (only its open round trip ran),
// rifty `"data"`. `'beforeExit'` around the last callbacks (Node: `beforeExit 0`, a `stat` it
// schedules, `beforeExit 0`, `exit 0`) is never emitted on any rifty host: `runtime-js/process-before-exit-event`.

export const FS_IO_TURN_CHAIN = `const fs = require('node:fs');
fs.writeFileSync('c.txt', 'x');
let n = 0;
const step = () => fs.readFile('c.txt', (e) => {
  if (e) throw e;
  if (++n < 1000) step();
  else console.log('chain done ' + n);
});
step();
process.on('exit', (code) => console.log('exit ' + code + ' n=' + n));
`;

export const FS_IO_TURN_ESM_LOOP = `import fs from 'node:fs';
fs.writeFileSync('m.txt', 'abc');
let bytes = 0;
for (let i = 0; i < 256; i++) bytes += (await fs.promises.readFile('m.txt')).length;
await fs.promises.stat('missing.txt').catch((e) => console.log('rejected ' + e.code));
console.log('top-level await loop bytes=' + bytes);
process.on('exit', (code) => console.log('exit ' + code));
`;

/** One process end per mode, with a write submitted and not yet run. */
export const FS_IO_TURN_EXIT_CHILD = `const fs = require('node:fs');
const fd = () => fs.openSync('e.txt', 'w');
const mode = process.argv[2];
if (mode === 'exit') { fs.write(fd(), 'data', () => console.log('cb')); process.exit(0); }
else if (mode === 'throw') { fs.write(fd(), 'data', () => console.log('cb')); throw new Error('boom'); }
else if (mode === 'reject') { fs.write(fd(), 'data', () => console.log('cb')); Promise.reject(new Error('r')); }
else if (mode === 'exit-listener') { const f = fd(); process.on('exit', () => fs.write(f, 'x', () => console.log('cb'))); process.exit(0); }
else if (mode === 'exit-in-callback') { const f = fd(); fs.stat('.', () => { fs.write(f, 'late', () => console.log('cb')); process.exit(0); }); fs.write(f, 'early', 0, 'utf8', () => {}); }
`;

export const FS_IO_TURN_EXIT_PARENT = `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const run = (mode) => new Promise((resolve) => {
  const child = spawn('node', ['child.js', mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.setEncoding('utf8').on('data', (c) => { out += c; });
  child.stderr.resume();
  child.on('close', (code) => {
    const file = fs.existsSync('e.txt') ? JSON.stringify(fs.readFileSync('e.txt', 'utf8')) : 'absent';
    fs.rmSync('e.txt', { force: true });
    resolve(mode + ' => exit ' + code + ', stdout ' + JSON.stringify(out) + ', file ' + file);
  });
});
(async () => {
  for (const mode of ['exit', 'throw', 'reject', 'exit-listener', 'exit-in-callback']) console.log(await run(mode));
})();
`;

export const FS_IO_TURN_WORKER = `const fs = require('node:fs');
const { parentPort } = require('node:worker_threads');
fs.write(fs.openSync('e.txt', 'w'), 'data', () => parentPort.postMessage('cb'));
parentPort.postMessage('submitted');
const until = Date.now() + 300;
while (Date.now() < until);
`;

export const FS_IO_TURN_WORKER_TERMINATE = `const { Worker } = require('node:worker_threads');
const w = new Worker(require('node:path').join(__dirname, 'worker.js'));
w.on('message', (m) => { if (m === 'submitted') w.terminate().then((code) => console.log('terminate resolved ' + code)); else console.log('worker callback ran'); });
w.on('exit', (code) => console.log('worker exit ' + code));
process.on('exit', (code) => console.log('main exit ' + code));
`;

export const fsIoTurnPrograms = [
  {
    name: 'fs-callback-turn-order',
    files: { 'main.js': callbackTurnOrderCase.code },
    argv: ['main.js'],
  },
  {
    name: 'fs-callback-chain-lifecycle',
    files: { 'main.js': FS_IO_TURN_CHAIN },
    argv: ['main.js'],
  },
  {
    name: 'fs-promises-esm-await-loop',
    files: { 'main.mjs': FS_IO_TURN_ESM_LOOP },
    argv: ['main.mjs'],
  },
  {
    name: 'fs-exit-completes-submitted',
    files: { 'main.js': FS_IO_TURN_EXIT_PARENT, 'child.js': FS_IO_TURN_EXIT_CHILD },
    argv: ['main.js'],
  },
  {
    name: 'fs-worker-terminate-in-flight',
    files: { 'main.js': FS_IO_TURN_WORKER_TERMINATE, 'worker.js': FS_IO_TURN_WORKER },
    argv: ['main.js'],
  },
] as const;
