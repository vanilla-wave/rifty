import { basename } from 'node:path';
import handleKeepalive from '../../../tools/node-parity-runner/cases/worker_threads/handle-keepalive.case.ts';
import handleListenerReference from '../../../tools/node-parity-runner/cases/worker_threads/handle-listener-reference.case.ts';
import handleNapiRsUnref from '../../../tools/node-parity-runner/cases/worker_threads/handle-napi-rs-unref.case.ts';
import handleReferenceApi from '../../../tools/node-parity-runner/cases/worker_threads/handle-reference-api.case.ts';
import handleRemoveAllListeners from '../../../tools/node-parity-runner/cases/worker_threads/handle-remove-all-listeners.case.ts';
import workerNaturalExit from '../../../tools/node-parity-runner/cases/worker_threads/worker-natural-exit.case.ts';
import workerPortEsm from '../../../tools/node-parity-runner/cases/worker_threads/worker-port-esm.case.ts';
import workerPortHeld from '../../../tools/node-parity-runner/cases/worker_threads/worker-port-held.case.ts';
import workerPortReference from '../../../tools/node-parity-runner/cases/worker_threads/worker-port-reference.case.ts';
import type { ParityCase } from '../../../tools/node-parity-runner/src/types.ts';
import type { AdvancedIpcProgram } from './advanced-ipc-cases.ts';

/**
 * ADR-0446 programs for a real Chromium child realm (`node main.cjs` in the
 * owner terminal) and live Node. The nine parity programs run verbatim as
 * `program.cjs`; `main.cjs` only prefixes the parent's console rows with `WT|`
 * so shell noise and stderr stay out of the comparison. The other programs add
 * what the parity harness cannot see: the process's own 'exit' event, the time
 * the parent stayed alive, and the `node <file>` / execSync natural exits.
 */
const MAIN = `const log = console.log;
console.log = (...args) => log(args.join(' ').split('\\n').map((line) => 'WT|' + line).join('\\n'));
require('./program.cjs');
`;

function program(
  name: string,
  source: string,
  files: Readonly<Record<string, string>>,
): AdvancedIpcProgram {
  return { name, main: MAIN, files: { ...files, 'program.cjs': source } };
}

function fromParityCase(name: string, parityCase: ParityCase): AdvancedIpcProgram {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(parityCase.setup?.files ?? {})) {
    files[basename(path)] = content;
  }
  return program(name, parityCase.code, files);
}

const lateWorker =
  "const { parentPort } = require('node:worker_threads');\n" +
  "setTimeout(() => parentPort.postMessage('hi'), 700);\n";

export const workerHandlePrograms: readonly AdvancedIpcProgram[] = [
  fromParityCase('handle-keepalive', handleKeepalive),
  fromParityCase('handle-reference-api', handleReferenceApi),
  fromParityCase('handle-listener-reference', handleListenerReference),
  fromParityCase('handle-napi-rs-unref', handleNapiRsUnref),
  fromParityCase('worker-natural-exit', workerNaturalExit),
  fromParityCase('worker-port-reference', workerPortReference),
  fromParityCase('worker-port-held', workerPortHeld),
  fromParityCase('handle-remove-all-listeners', handleRemoveAllListeners),
  fromParityCase('worker-port-esm', workerPortEsm),
  // Goal I2's oracle program (vitest-run-in-browser evidence §Oracle, t3.cjs).
  program(
    'i2-oracle',
    `const { Worker } = require('node:worker_threads');
const t0 = Date.now();
const w = new Worker('./w.cjs');
w.on('message', (m) => console.log('got', m, Date.now() - t0 >= 600));
w.on('exit', (c) => console.log('wexit', c));
process.on('exit', (c) => console.log('EXIT', c));
`,
    { 'w.cjs': lateWorker },
  ),
  // An unref()'d Worker: the process 'exit' fires before the worker's message.
  program(
    'unref-process-exit',
    `const { Worker } = require('node:worker_threads');
const w = new Worker('./w.cjs');
w.on('message', (m) => console.log('got', m));
w.on('exit', (c) => console.log('wexit', c));
w.unref();
process.on('exit', (c) => console.log('EXIT', c));
console.log('start');
`,
    { 'w.cjs': lateWorker },
  ),
  // Natural exit never calls a reassigned `process.exit` — the `node <file>`
  // owner here, the execSync child owner next (worker threads: parity
  // worker-natural-exit; `node -e`: parity process/natural-exit-patched-process-exit).
  program(
    'patched-exit-program',
    `process.on('exit', (c) => console.log('exit-event', c));
process.exit = () => { throw new Error('patched process.exit called'); };
setTimeout(() => console.log('tick'), 20);
`,
    {},
  ),
  program(
    'patched-exit-exec-sync',
    `const { execSync } = require('node:child_process');
try {
  const out = execSync('node child.cjs', { encoding: 'utf8', stdio: 'pipe' });
  for (const row of out.split('\\n').filter(Boolean)) console.log('child', row);
  console.log('exec-ok');
} catch (error) {
  console.log('exec-failed', error.status);
}
`,
    {
      'child.cjs': `process.on('exit', (c) => console.log('exit-event', c));
process.exit = () => { throw new Error('patched process.exit called'); };
setTimeout(() => console.log('tick'), 20);
`,
    },
  ),
];

export function workerRows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('WT|'));
}
