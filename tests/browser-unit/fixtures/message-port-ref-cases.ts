import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { sealedWorkbenchFixtureUrl } from '../fixtures.ts';

/**
 * ADR-0447 cases: one CommonJS program, executed verbatim by real Node (the
 * live oracle below) and by rifty `node main.cjs`. `Atomics.waitAsync` is the
 * pending work that holds no handle in either runtime, so only a referenced
 * MessagePort can keep the program alive until it settles.
 */
export interface MessagePortRefCase {
  readonly name: string;
  readonly source: string;
}

const pendingWork = `const cell = new Int32Array(new SharedArrayBuffer(4));
const pendingWork = (ms) => Atomics.waitAsync(cell, 0, 0, ms).value;
`;

export const messagePortRefCases: readonly MessagePortRefCase[] = [
  {
    name: 'api-shape',
    source: `const wt = require('node:worker_threads');
const channel = new MessageChannel();
const builtin = new wt.MessageChannel();
const port = channel.port1;
const illegal = (method) => {
  try { MessagePort.prototype[method].call({}); return 'no-throw'; }
  catch (error) { return error.name + ':' + error.message; }
};
console.log('PORT|alias=' + (MessageChannel === wt.MessageChannel));
console.log('PORT|constructor=' + (channel.constructor === MessageChannel) + ',' + (builtin.constructor === wt.MessageChannel) + ',' + MessageChannel.name + ',' + MessageChannel.length);
console.log('PORT|native=' + (port instanceof MessagePort && builtin.port2 instanceof MessagePort));
console.log('PORT|types=' + [port.ref, port.unref, port.hasRef, builtin.port1.ref].map((f) => typeof f).join(','));
console.log('PORT|fresh=' + [port.hasRef(), channel.port2.hasRef(), builtin.port1.hasRef()].join(','));
console.log('PORT|ref-return=' + typeof port.ref());
console.log('PORT|referenced=' + port.hasRef() + ',' + channel.port2.hasRef());
port.ref();
console.log('PORT|unref-return=' + typeof port.unref());
console.log('PORT|double-ref-single-unref=' + port.hasRef());
builtin.port1.ref();
console.log('PORT|builtin-ref=' + builtin.port1.hasRef());
builtin.port1.unref();
console.log('PORT|builtin-unref=' + builtin.port1.hasRef());
console.log('PORT|illegal=' + ['ref', 'unref', 'hasRef'].map(illegal).join(','));
`,
  },
  {
    name: 'reference-holds-until-unref',
    source: `${pendingWork}const held = new MessageChannel().port1;
const fresh = new MessageChannel().port1;
const released = new MessageChannel().port1;
// @emnapi/runtime calls ref/unref only when present (emnapi.cjs.js:1189,1199).
if (held.ref) held.ref();
if (released.ref) { released.ref(); released.unref(); }
console.log('PORT|start');
pendingWork(300).then((result) => {
  console.log('PORT|late=' + result + ',' + held.hasRef() + ',' + fresh.hasRef() + ',' + released.hasRef());
  if (held.unref) held.unref();
  console.log('PORT|after-unref=' + held.hasRef());
});
`,
  },
  {
    name: 'emnapi-waiting-request-counter',
    source: `${pendingWork}// Verbatim @emnapi/runtime@1.10.0 dist/emnapi.cjs.js:120-128 (_require = require)
const _MessageChannel = typeof MessageChannel === 'function'
    ? MessageChannel
    : (function () {
        try {
            return require('worker_threads').MessageChannel;
        }
        catch (_) { }
        return undefined;
    })();
// Verbatim @emnapi/runtime@1.10.0 dist/emnapi.cjs.js:1182-1205
class NodejsWaitingRequestCounter {
    constructor() {
        this.refHandle = new _MessageChannel().port1;
        this.count = 0;
    }
    increase() {
        if (this.count === 0) {
            if (this.refHandle.ref) {
                this.refHandle.ref();
            }
        }
        this.count++;
    }
    decrease() {
        if (this.count === 0)
            return;
        if (this.count === 1) {
            if (this.refHandle.unref) {
                this.refHandle.unref();
            }
        }
        this.count--;
    }
}
const counter = new NodejsWaitingRequestCounter();
const work = (name, ms) => {
  counter.increase();
  pendingWork(ms).then(() => {
    console.log('PORT|done=' + name + ',count=' + counter.count);
    counter.decrease();
  });
};
work('a', 150);
work('b', 300);
console.log('PORT|queued=' + counter.count);
`,
  },
  {
    name: 'close-releases',
    source: `${pendingWork}const { port1: port } = new MessageChannel();
port.ref();
pendingWork(150).then(() => {
  console.log('PORT|before-close=' + port.hasRef());
  port.close();
  pendingWork(300).then(() => console.log('PORT|held-after-close'));
});
`,
  },
  {
    name: 'peer-close-releases',
    source: `${pendingWork}const { port1: port, port2: peer } = new MessageChannel();
port.ref();
peer.close();
setTimeout(() => {
  port.ref();
  console.log('PORT|after-peer-close=' + port.hasRef() + ',' + peer.hasRef());
  pendingWork(300).then(() => console.log('PORT|held-after-peer-close'));
}, 50);
`,
  },
  {
    name: 'ref-after-close-does-not-hold',
    source: `${pendingWork}const { port1: port, port2: peer } = new MessageChannel();
port.close();
setTimeout(() => {
  console.log('PORT|ref-return=' + typeof port.ref());
  console.log('PORT|closed-ref=' + port.hasRef() + ',' + peer.hasRef());
  pendingWork(300).then(() => console.log('PORT|held-by-closed-port'));
}, 50);
`,
  },
  {
    name: 'unreferenced-transfer-stays-native',
    source: `const holder = new MessageChannel().port1;
holder.ref();
const { port1: a, port2: b } = new MessageChannel();
const { port1: c, port2: d } = new MessageChannel();
const buffer = new Uint8Array([1, 2, 3]).buffer;
let reads = 0;
const options = { get transfer() { reads++; return new Set([c, buffer]); } };
b.onmessage = (event) => {
  const [received, bytes] = event.data;
  console.log('PORT|received=' + (received instanceof MessagePort) + ',' + (received !== c) + ',' + Array.from(new Uint8Array(bytes)).join('.'));
  received.onmessage = (inner) => {
    console.log('PORT|through-transferred=' + inner.data);
    received.close();
    a.close();
    b.close();
    holder.unref();
  };
  d.postMessage('ping');
};
a.postMessage([c, buffer], options);
console.log('PORT|detached=' + buffer.byteLength + ',reads=' + reads);
const e = new MessageChannel();
const clone = structuredClone({ port: e.port1 }, Object.freeze({ transfer: [e.port1] }));
console.log('PORT|clone=' + (clone.port instanceof MessagePort) + ',' + (clone.port !== e.port1));
clone.port.close();
`,
  },
];

/** Fault matrix row 1 (torn-state): one port contributes exactly 0 or 1 hold. */
export const refcountIsolationCase: MessagePortRefCase = {
  name: 'refcount-isolation',
  source: `${pendingWork}setTimeout(() => console.log('PORT|timer'), 300);
const redundant = new MessageChannel().port1;
redundant.ref();
redundant.unref();
redundant.unref();
redundant.close();
redundant.close();
redundant.unref();
const doubled = new MessageChannel().port1;
doubled.ref();
doubled.ref();
pendingWork(100).then(() => {
  console.log('PORT|late=' + doubled.hasRef());
  doubled.unref();
  console.log('PORT|released=' + doubled.hasRef());
});
`,
};

/**
 * Fault matrix rows 2-3 (provenance-lie): Chromium gives no close or detach
 * signal (evidence §Chromium), so a release that would happen on the far side
 * of a transfer can't be observed. Every such move is refused with a named throw
 * before anything is detached (ADR-0447); Node allows it, so this is an explicit
 * gap and has no Node rows. Every browser transfer entry point is covered.
 */
export const transferCeilingCase: MessagePortRefCase = {
  name: 'transfer-ceiling',
  source: `const worker = new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' })));
console.log('PORT|worker=' + typeof worker.postMessage);
const rows = [];
const outcome = (fn, buffer) => {
  try { fn(); return 'no-throw'; }
  catch (error) { return error.name + ':' + error.feature + ',' + buffer.byteLength; }
};
const { port1: held, port2: peer } = new MessageChannel();
held.ref();
const { port1: via } = new MessageChannel();
const entries = [
  ['port-postMessage', (value, list) => via.postMessage(value, list)],
  ['structuredClone', (value, list) => structuredClone(value, { transfer: list })],
  ['worker-postMessage', (value, list) => worker.postMessage(value, list)],
  ['global-postMessage', (value, list) => postMessage(value, list)],
];
for (const [name, send] of entries) {
  for (const [label, target] of [['referenced', held], ['peer', peer]]) {
    const buffer = new ArrayBuffer(4);
    rows.push(name + '-' + label + '=' + outcome(() => send({ target, buffer }, [target, buffer]), buffer));
  }
}
const { port1: kept, port2: sent } = new MessageChannel();
const copy = structuredClone(sent, { transfer: [sent] });
for (const [label, port] of [['peer-transferred', kept], ['received', copy]]) {
  try { port.ref(); rows.push('ref-' + label + '=no-throw'); }
  catch (error) { rows.push('ref-' + label + '=' + error.name + ':' + error.feature + ',' + port.hasRef()); }
}
copy.close();
held.onmessage = (event) => {
  rows.push('still-entangled=' + event.data + ',' + held.hasRef());
  for (const row of rows) console.log('PORT|' + row);
  held.unref();
  held.close();
  via.close();
  worker.terminate();
};
peer.postMessage('after-refused-transfers');
`,
};

/** ADR-0447 named outcome of {@link transferCeilingCase}; Node has no counterpart. */
export const transferCeilingRows: readonly string[] = [
  'PORT|worker=function',
  ...['port-postMessage', 'structuredClone', 'worker-postMessage', 'global-postMessage'].flatMap(
    (name) =>
      ['referenced', 'peer'].map(
        (label) => `PORT|${name}-${label}=NotImplementedError:MessagePort.transfer.referenced,4`,
      ),
  ),
  'PORT|ref-peer-transferred=NotImplementedError:MessagePort.ref.transferred,false',
  'PORT|ref-received=NotImplementedError:MessagePort.ref.transferred,false',
  'PORT|still-entangled=after-refused-transfers,true',
];

/** Runs one project terminal line; `timedOut` instead of waiting out a held drain. */
export function runOwnerCommand(
  page: Page,
  line: string,
  deadlineMs: number,
): Promise<{ readonly timedOut: boolean; readonly exit: number | null; readonly out: string }> {
  return page.evaluate(
    async ({ fixtureUrl, command, deadline }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const terminal = fixture.currentProject().terminals.open();
      let out = '';
      const detach = terminal.attach((chunk: string) => {
        out += chunk;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const run = terminal.run(command);
        const outcome = await Promise.race([
          run.exited.then((exit: { readonly code: number | null }) => ({
            timedOut: false,
            exit: exit.code,
          })),
          new Promise<{ timedOut: true; exit: null }>((resolve) => {
            timer = setTimeout(() => resolve({ timedOut: true, exit: null }), deadline);
          }),
        ]);
        return { ...outcome, out };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        detach();
        await terminal.close();
      }
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, command: line, deadline: deadlineMs },
  );
}

export function portRows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line.startsWith('PORT|'));
}

export async function runNodeOracle(source: string): Promise<{
  readonly version: string;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-message-port-ref-'));
  try {
    await writeFile(join(directory, 'main.cjs'), source);
    const started = Date.now();
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['main.cjs'], {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const deadline = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Node oracle timed out:\n${stdout}\n${stderr}`));
      }, 10_000);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(deadline);
        resolve({
          version: process.version,
          code,
          stdout,
          stderr,
          elapsedMs: Date.now() - started,
        });
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
