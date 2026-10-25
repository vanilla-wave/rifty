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

/**
 * A Worker whose start fails (ADR-0446 §3): 'error', or the parent's uncaught
 * exception when unlistened, and 'exit' 1 unless that exception ended the
 * owner. Rifty's loud `data:` URL gap fails the start in the parent, as a
 * missing entry file does in Node, so the live-Node run takes `./missing.cjs`.
 * `wexitAlways`: Node prints the `wexit 1` row on every run (see
 * {@link failedStartRows}).
 */
const failedStartSources: ReadonlyArray<{
  readonly name: string;
  readonly wexitAlways: boolean;
  readonly source: string;
}> = [
  {
    name: 'failed-start-uncaught',
    wexitAlways: true,
    source: `process.on('uncaughtException', (e) => {
  console.log('uncaught', e instanceof Error);
  queueMicrotask(() => console.log('micro'));
});
process.on('exit', (c) => console.log('EXIT', c));
const w = new Worker(ENTRY);
w.on('message', () => {});
w.on('exit', (c) => console.log('wexit', c));
console.log('start');
`,
  },
  {
    name: 'failed-start-fatal',
    wexitAlways: false,
    source: `process.on('exit', (c) => console.log('EXIT', c));
const w = new Worker(ENTRY);
w.on('message', () => {});
w.on('exit', (c) => console.log('wexit', c));
console.log('start');
`,
  },
  {
    name: 'failed-start-listened',
    wexitAlways: true,
    source: `process.on('exit', (c) => console.log('EXIT', c));
const w = new Worker(ENTRY);
w.on('message', () => {});
w.on('error', (e) => {
  console.log('error', e instanceof Error);
  queueMicrotask(() => console.log('micro'));
});
w.on('exit', (c) => console.log('wexit', c));
console.log('start');
`,
  },
];

function failedStartProgram(name: string, source: string, entry: string): AdvancedIpcProgram {
  const code = `const { Worker } = require('node:worker_threads');\n${source}`;
  return program(name, code.replace('ENTRY', entry), {});
}

export const failedStartPrograms: ReadonlyArray<{
  readonly node: AdvancedIpcProgram;
  readonly rifty: AdvancedIpcProgram;
  readonly wexitAlways: boolean;
}> = failedStartSources.map(({ name, wexitAlways, source }) => ({
  node: failedStartProgram(name, source, "'./missing.cjs'"),
  rifty: failedStartProgram(name, source, "new URL('data:text/javascript,0')"),
  wexitAlways,
}));

/**
 * Node races a failed start's worker 'exit' against the error it follows
 * (evidence §Final+GREEN r2 reception): the `wexit` row's place, and whether
 * it prints before a fatal uncaught exception ends the parent, vary with loop
 * timing. So the live-Node comparison keeps the other rows in order and the
 * `wexit` rows only where Node always prints them; the fault test pins rifty's
 * order.
 */
export function failedStartRows(
  rows: readonly string[],
  wexitAlways: boolean,
): { readonly ordered: readonly string[]; readonly wexit?: readonly string[] } {
  const isWexit = (row: string): boolean => row.startsWith('WT|wexit');
  const ordered = rows.filter((row) => !isWexit(row));
  return wexitAlways ? { ordered, wexit: rows.filter(isWexit) } : { ordered };
}

export function workerRows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('WT|'));
}
