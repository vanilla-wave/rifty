import type { ParityCase } from '../../src/types.ts';

/**
 * A fork child's IPC hold follows every way a `'message'` listener is added —
 * Node keys it to `'newListener'`, so the base prototype's `on` and
 * `addListener`, `prependListener` and `once` all keep the child alive until
 * the parent's late message arrives — also when a guest `'newListener'` hook
 * removes the previous listener(s) mid-add.
 */
const child = (attach: string) => `
  const p = typeof __process === 'undefined' ? process : __process;
  const EventEmitter = require('node:events');
  const handler = () => { p.send('pong'); p.disconnect(); };
  ${attach};
  p.send('armed');
`;

const paths = {
  baseOn: 'EventEmitter.prototype.on.call(p, "message", handler)',
  baseAddListener: 'EventEmitter.prototype.addListener.call(p, "message", handler)',
  addListener: 'p.addListener("message", handler)',
  prepend: 'p.prependListener("message", handler)',
  once: 'p.once("message", handler)',
  // A 'newListener' hook removing the previous listener mid-add (Node counts refs).
  replace: [
    'const previous = () => {}',
    'p.on("message", previous)',
    'p.on("newListener", (e) => { if (e === "message") p.removeListener("message", previous); })',
    'p.addListener("message", handler)',
  ].join('; '),
  // The same mid-add hook clearing through removeAllListeners (Node unrefs per listener).
  replaceAll: [
    'p.on("message", () => {})',
    'p.on("newListener", (e) => { if (e === "message") p.removeAllListeners("message"); })',
    'p.addListener("message", handler)',
  ].join('; '),
  clearAll: [
    'p.on("message", () => {})',
    'p.on("newListener", (e) => { if (e === "message") p.removeAllListeners(); })',
    'p.addListener("message", handler)',
  ].join('; '),
  // removeAllListeners('message') releases the hold: the child exits before its unref'd timer.
  released: [
    'p.on("message", handler)',
    'p.removeAllListeners("message")',
    'setTimeout(() => { p.send("hung"); p.disconnect(); }, 500).unref()',
  ].join('; '),
  // Without Node's release hook, removeAllListeners('message') releases nothing: still held.
  noReleaseHook: [
    'p.on("message", handler)',
    'p.removeAllListeners("removeListener")',
    'p.removeAllListeners("message")',
    'setTimeout(() => { p.send("alive"); p.disconnect(); }, 300).unref()',
  ].join('; '),
};

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: Object.keys(paths).length,
  cwd: '/project',
  setup: {
    files: Object.fromEntries(
      Object.entries(paths).map(([name, attach]) => [`project/${name}.js`, child(attach)]),
    ),
  },
  code: `
    const { fork } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const run = (name) => new Promise((resolve) => {
      const messages = [];
      const child = fork(name + '.js', [], { cwd, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child.on('message', (m) => {
        messages.push(m);
        if (m === 'armed') setTimeout(() => { if (child.connected) child.send('ping'); }, 100);
      });
      child.on('exit', (code) => resolve([name, messages, code]));
    });
    void (async () => {
      const out = [];
      for (const name of ${JSON.stringify(Object.keys(paths))}) out.push(await run(name));
      console.log(JSON.stringify(out));
    })();
  `,
  expected:
    '[["baseOn",["armed","pong"],0],["baseAddListener",["armed","pong"],0],["addListener",["armed","pong"],0],["prepend",["armed","pong"],0],["once",["armed","pong"],0],["replace",["armed","pong"],0],["replaceAll",["armed","pong"],0],["clearAll",["armed","pong"],0],["released",["armed"],0],["noReleaseHook",["armed","alive"],0]]\n',
};

export default c;
