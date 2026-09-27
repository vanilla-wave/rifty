export interface WorkerLifecycleCase {
  readonly name: string;
  readonly entry: 'main.cjs' | 'main.mjs' | 'eval';
  readonly parent: string;
  readonly child: string;
}

const exitHook = `process.once('exit', (code) => console.log('WORKER|parent-exit=' + code));`;
const lateChild = `
const { parentPort } = require('node:worker_threads');
setTimeout(() => parentPort.postMessage('late'), 100);
`;
const cjsParent = `
const { Worker } = require('node:worker_threads');
const worker = new Worker('./child.cjs');
worker.on('message', (message) => console.log('WORKER|message=' + message));
worker.on('exit', (code) => console.log('WORKER|exit=' + code));
${exitHook}
`;

const esmWorker = `
import { Worker } from 'node:worker_threads';
const worker = new Worker(new URL('./child.cjs', import.meta.url));
const exited = new Promise((resolve, reject) => {
  worker.once('error', reject);
  worker.once('exit', (code) => { console.log('WORKER|exit=' + code); resolve(code); });
});
${exitHook}
`;

const stdioChild = `
process.stdout.write('WORKER|stdout\\n');
process.stderr.write('WORKER|stderr\\n');
console.log('WORKER|console-stdout');
console.error('WORKER|console-stderr');
`;

const cases: readonly WorkerLifecycleCase[] = [
  { name: 'parent-live-worker', entry: 'main.cjs', parent: cjsParent, child: lateChild },
  {
    name: 'first-message-listener-refs',
    entry: 'main.cjs',
    parent: cjsParent.replace(
      "const worker = new Worker('./child.cjs');",
      "const worker = new Worker('./child.cjs'); worker.unref();",
    ),
    child: lateChild,
  },
  {
    name: 'ref-return-values',
    entry: 'main.cjs',
    parent: `
const { Worker } = require('node:worker_threads');
const worker = new Worker('./child.cjs');
console.log('WORKER|ref-returns=' + JSON.stringify([typeof worker.unref(), typeof worker.ref()]));
worker.on('message', (message) => console.log('WORKER|port-ref-returns=' + JSON.stringify(message)));
${exitHook}
`,
    child: `
const { parentPort } = require('node:worker_threads');
parentPort.postMessage([typeof parentPort.ref(), typeof parentPort.unref()]);
`,
  },
  {
    name: 'additional-message-listener-keeps-unref',
    entry: 'main.cjs',
    parent: `${cjsParent}\nworker.unref(); worker.on('message', () => {});`,
    child: lateChild,
  },
  {
    name: 'removed-message-listener-unrefs',
    entry: 'main.cjs',
    parent: `
const { Worker } = require('node:worker_threads');
const worker = new Worker('./child.cjs');
worker.unref();
const listener = () => console.log('WORKER|unexpected-message');
worker.on('message', listener);
worker.removeListener('message', listener);
${exitHook}
`,
    child: lateChild,
  },
  {
    name: 'once-message-listener-releases-ref',
    entry: 'main.cjs',
    parent: `
const { Worker } = require('node:worker_threads');
const worker = new Worker('./child.cjs');
worker.unref();
worker.once('message', (message) => console.log('WORKER|message=' + message));
${exitHook}
`,
    child: `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', () => {});
setTimeout(() => parentPort.postMessage('ready'), 100);
`,
  },
  {
    name: 'parent-ref-after-unref',
    entry: 'main.cjs',
    parent: `${cjsParent}\nworker.unref(); worker.ref(); worker.ref();`,
    child: lateChild,
  },
  {
    name: 'parent-unref',
    entry: 'main.cjs',
    parent: `${cjsParent}\nworker.unref(); worker.unref();`,
    child: 'setInterval(() => {}, 60_000);',
  },
  {
    name: 'child-natural-exit',
    entry: 'main.mjs',
    parent: `${esmWorker}
worker.on('message', (message) => console.log('WORKER|message=' + message));
await exited;
`,
    child: `require('node:worker_threads').parentPort.postMessage('immediate');`,
  },
  ...(['close', 'remove', 'unref'] as const).map(
    (release): WorkerLifecycleCase => ({
      name: `parent-port-${release}`,
      entry: 'main.mjs',
      parent: `${esmWorker}
worker.on('message', (message) => {
  console.log('WORKER|message=' + message);
  if (message === 'ready') setTimeout(() => worker.postMessage('ping'), 50);
});
await exited;
`,
      child: `
const { parentPort } = require('node:worker_threads');
function onMessage(message) {
  parentPort.postMessage('reply:' + message);
  ${release === 'close' ? 'parentPort.close();' : release === 'remove' ? "parentPort.removeListener('message', onMessage);" : 'parentPort.unref();'}
}
parentPort.on('message', onMessage);
parentPort.postMessage('ready');
`,
    }),
  ),
  {
    name: 'parent-port-onmessage-setter',
    entry: 'main.mjs',
    parent: `${esmWorker}
worker.on('message', (message) => {
  console.log('WORKER|message=' + message);
  if (message === 'ready') setTimeout(() => worker.postMessage('ping'), 50);
});
await exited;
`,
    child: `
const { parentPort } = require('node:worker_threads');
parentPort.onmessage = (event) => {
  parentPort.postMessage('reply:' + event.data);
  parentPort.onmessage = null;
};
parentPort.postMessage('ready');
`,
  },
  {
    name: 'stdio-capture',
    entry: 'main.mjs',
    parent: `
import { Worker } from 'node:worker_threads';
import { Readable } from 'node:stream';
const worker = new Worker(new URL('./child.cjs', import.meta.url), { stdout: true, stderr: true });
${exitHook}
const shape = [worker.stdout instanceof Readable, worker.stderr instanceof Readable,
  typeof worker.stdout.pipe, typeof worker.stderr.pipe];
const collect = (stream) => new Promise((resolve, reject) => {
  let output = '';
  stream.on('data', (chunk) => { output += chunk.toString(); });
  stream.once('error', reject);
  stream.once('end', () => resolve(output));
});
const [stdout, stderr, code] = await Promise.all([
  collect(worker.stdout), collect(worker.stderr),
  new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve); }),
]);
console.log('WORKER|captured=' + JSON.stringify({shape, stdout, stderr, code,
  ended: [worker.stdout.readableEnded, worker.stderr.readableEnded]}));
`,
    child: stdioChild,
  },
  {
    name: 'stdio-default',
    entry: 'main.mjs',
    parent: `${esmWorker}
console.log('WORKER|streams=' + JSON.stringify([typeof worker.stdout, typeof worker.stderr,
  typeof worker.stdout.pipe, typeof worker.stderr.pipe]));
await exited;
`,
    child: stdioChild,
  },
  {
    name: 'explicit-empty-exec-argv',
    entry: 'eval',
    parent: `
const { Worker } = require('node:worker_threads');
console.log('WORKER|parent-eval=' + (process.execArgv[0] === '-e'));
const worker = new Worker('./child.cjs', { execArgv: [] });
worker.on('message', (message) => console.log('WORKER|child-exec-argv=' + JSON.stringify(message)));
worker.on('exit', (code) => console.log('WORKER|exit=' + code));
${exitHook}
`,
    child: `require('node:worker_threads').parentPort.postMessage(process.execArgv);`,
  },
  {
    name: 'terminate-releases-once',
    entry: 'main.mjs',
    parent: `${esmWorker}
await new Promise((resolve) => worker.once('message', resolve));
console.log('WORKER|terminated=' + await worker.terminate());
console.log('WORKER|terminated-again=' + await worker.terminate());
await exited;
`,
    child: `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', () => {});
parentPort.postMessage('ready');
`,
  },
  {
    name: 'persistent-exit-counter',
    entry: 'main.mjs',
    parent: `
import { Worker } from 'node:worker_threads';
const worker = new Worker(new URL('./child.cjs', import.meta.url));
let exitCount = 0;
const exited = new Promise((resolve) => worker.on('exit', (code) => {
  console.log('WORKER|exit-event=' + (++exitCount) + ':' + code);
  resolve(code);
}));
process.on('exit', () => console.log('WORKER|exit-count=' + exitCount));
await new Promise((resolve) => worker.once('message', resolve));
console.log('WORKER|terminated=' + await worker.terminate());
await exited;
`,
    child: `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', () => {});
parentPort.postMessage('ready');
`,
  },
  {
    name: 'terminate-drains-stdio',
    entry: 'main.mjs',
    parent: `
import { Worker } from 'node:worker_threads';
const worker = new Worker(new URL('./child.cjs', import.meta.url), {stdout: true});
let output = '';
const ended = new Promise((resolve) => {
  worker.stdout.on('data', (chunk) => { output += chunk.toString(); });
  worker.stdout.once('end', resolve);
});
await new Promise((resolve) => worker.once('message', resolve));
const code = await worker.terminate();
await ended;
console.log('WORKER|terminal-output=' + JSON.stringify({code, exact: output === 'x'.repeat(262144)}));
${exitHook}
`,
    child: `
const { parentPort } = require('node:worker_threads');
process.stdout.write('x'.repeat(262144));
parentPort.on('message', () => {});
parentPort.postMessage('ready');
`,
  },
];

export const workerLifecycleCases: readonly WorkerLifecycleCase[] = cases.map((fixture) => ({
  ...fixture,
  parent: `globalThis.__riftyWorkerLifecycleParent = true;\n${fixture.parent}`,
  child: `if (globalThis.__riftyWorkerLifecycleParent) throw new Error('Worker shared parent global');\n${fixture.child}`,
}));

export function workerLifecycleRows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('WORKER|'));
}

export function workerLifecycleCommand(fixture: WorkerLifecycleCase): string {
  if (fixture.entry !== 'eval') return `node ${fixture.entry}`;
  return `node -e '${fixture.parent.replaceAll("'", "'\\''")}'`;
}
