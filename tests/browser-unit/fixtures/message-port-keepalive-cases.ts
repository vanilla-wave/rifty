import type { WorkerLifecycleCase } from './worker-lifecycle-cases.ts';

const exitHook = `process.on('exit', (code) => console.log('PORT|parent-exit=' + code));`;
const lateChild = `const { parentPort } = require('node:worker_threads'); setTimeout(() => parentPort.postMessage('late'), 100);`;
const startUnrefWorker = `
const { Worker } = require('node:worker_threads');
const worker = new Worker('./child.cjs');
worker.on('message', () => {
  console.log('PORT|late-message');
  port.unref?.();
});
worker.unref();
${exitHook}
`;

export const messagePortKeepaliveCases: readonly WorkerLifecycleCase[] = [
  {
    name: 'global-and-builtin-channel-alias',
    entry: 'main.cjs',
    parent: `
const GlobalChannel = MessageChannel;
const { MessageChannel: BuiltinChannel } = require('node:worker_threads');
const channel = new BuiltinChannel();
console.log('PORT|alias=' + JSON.stringify({same: GlobalChannel === BuiltinChannel,
  ref: typeof channel.port1.ref, unref: typeof channel.port1.unref, hasRef: typeof channel.port1.hasRef}));
channel.port1.close();channel.port2.close();
${exitHook}
`,
    child: '',
  },
  {
    name: 'manual-ref-holds',
    entry: 'main.cjs',
    parent: `
const port = new MessageChannel().port1;
port.ref?.();
${startUnrefWorker}
`,
    child: lateChild,
  },
  {
    name: 'idempotent-unref-drains',
    entry: 'main.cjs',
    parent: `
const port = new MessageChannel().port1;
console.log('PORT|initial=' + port.hasRef());
console.log('PORT|ref-returns=' + JSON.stringify([typeof port.ref(), typeof port.ref()]));
console.log('PORT|referenced=' + port.hasRef());
console.log('PORT|unref-return=' + typeof port.unref());
console.log('PORT|unreferenced=' + port.hasRef());
${startUnrefWorker}
`,
    child: lateChild,
  },
  {
    name: 'default-infrastructure-remains-unrefed',
    entry: 'main.cjs',
    parent: `const port = new MessageChannel().port1;\n${startUnrefWorker}`,
    child: lateChild,
  },
  ...(['own', 'peer'] as const).map(
    (side): WorkerLifecycleCase => ({
      name: `${side}-close-transition`,
      entry: 'main.cjs',
      parent: `
const {port1: port, port2: peer} = new MessageChannel();
const state = {};
let closes = 0;
port.ref();
port.addEventListener('close', () => {
  closes++;
  state.close = port.hasRef();
  state.refReturn = typeof port.ref();
  state.refAfterClose = port.hasRef();
  peer.close();
});
${side === 'own' ? 'port' : 'peer'}.close();
state.sync = port.hasRef();
queueMicrotask(() => { state.microtask = port.hasRef(); });
setImmediate(() => { state.immediate = port.hasRef(); });
process.on('exit', (code) => console.log('PORT|close=' + JSON.stringify({
  sync: state.sync, microtask: state.microtask, immediate: state.immediate,
  close: state.close, refReturn: state.refReturn, refAfterClose: state.refAfterClose,
  closes, code,
})));
`,
      child: '',
    }),
  ),
  {
    name: 'queued-message-before-peer-close',
    entry: 'main.cjs',
    parent: `
const channel = new MessageChannel();
const port = channel.port1, peer = channel.port2;
const events = [];
let closes = 0;
let received = null;
let refAtMessage = null;
port.addEventListener('message', (event) => {
  received = event.data;
  refAtMessage = port.hasRef();
  events.push('message');
});
port.addEventListener('close', () => { closes++; events.push('close'); });
port.start();
port.ref();
peer.postMessage({text: 'queued', bytes: new Uint8Array([3, 7, 11])});
peer.close();
events.push('sync');
queueMicrotask(() => events.push('microtask'));
setImmediate(() => events.push('immediate'));
process.on('exit', () => console.log('PORT|queued=' + JSON.stringify({
  samePort: port === channel.port1,
  nativePort: port instanceof MessagePort,
  text: received?.text,
  bytes: received ? Array.from(received.bytes) : null,
  refAtMessage,
  syncBeforeMessage: events.indexOf('sync') < events.indexOf('message'),
  microtaskBeforeMessage: events.indexOf('microtask') < events.indexOf('message'),
  messageBeforeClose: events.indexOf('message') < events.indexOf('close'),
  immediateBeforeClose: events.indexOf('immediate') < events.indexOf('close'),
  closes,
  hasRefAfterClose: port.hasRef(),
})));
`,
    child: '',
  },
  {
    name: 'transfer-overloads-remain-native',
    entry: 'main.cjs',
    parent: `
const {port1: port, port2: peer} = new MessageChannel();
let received = 0;
port.onmessage = (event) => {
  console.log('PORT|overload-bytes=' + JSON.stringify(Array.from(new Uint8Array(event.data))));
  if (++received === 3) { port.unref(); port.close(); peer.close(); }
};
port.ref();
for (const mode of ['set', 'frozen', 'getter']) {
  const buffer = new Uint8Array([1, 6, 10]).buffer;
  let reads = 0;
  const options = mode === 'set' ? new Set([buffer]) : mode === 'frozen'
    ? Object.freeze({transfer: [buffer]}) : {get transfer() { reads++; return [buffer]; }};
  peer.postMessage(buffer, options);
  console.log('PORT|overload=' + JSON.stringify([mode, buffer.byteLength, reads]));
}
const cloneBuffer = new Uint8Array([3, 8]).buffer;
const clone = structuredClone(cloneBuffer, Object.freeze({transfer: [cloneBuffer]}));
console.log('PORT|frozen-clone=' + JSON.stringify([cloneBuffer.byteLength, Array.from(new Uint8Array(clone))]));
${exitHook}
`,
    child: '',
  },
  {
    name: 'array-buffer-transfer-remains-native',
    entry: 'main.cjs',
    parent: `
const {port1: port, port2: peer} = new MessageChannel();
port.addEventListener('message', (event) => {
  console.log('PORT|buffer=' + JSON.stringify(Array.from(new Uint8Array(event.data))));
  port.unref();
  port.close(); peer.close();
});
port.start(); port.ref();
const buffer = new Uint8Array([2, 5, 9]).buffer;
peer.postMessage(buffer, [buffer]);
console.log('PORT|detached=' + (buffer.byteLength === 0));
${exitHook}
`,
    child: '',
  },
];

export function messagePortRows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('PORT|'));
}
