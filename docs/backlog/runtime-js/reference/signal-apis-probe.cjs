// Probe of runtime-js/signal-apis-as-node (2026-11-26): one line per row, `name => outcome`.
// Node: `node signal-apis-probe.cjs` in an empty dir (v24.16.0). Isolate: `sandbox.exec` of this file
// (@riftydev/isolate-host). In-process (browser hosts' code path): this text as a parity case's
// `code` (tools/node-parity-runner, `pnpm test:parity <case>`): the diff shows rifty's lines.
const fs = require('node:fs');
const tp = require('node:timers/promises');
const t = (e) =>
  e
    ? `${e.constructor.name}|${e.name}|${e.code}|${e.cause !== undefined ? `cause=${e.cause?.name || String(e.cause)}` : ''}`
    : String(e);
const rows = [
  ['tp.setTimeout aborted', () => tp.setTimeout(5, 'v', { signal: AbortSignal.abort() })],
  [
    'tp.setTimeout abort later',
    () => {
      const ac = new AbortController();
      const p = tp.setTimeout(50, 'v', { signal: ac.signal });
      ac.abort();
      return p;
    },
  ],
  ['tp.setImmediate aborted why', () => tp.setImmediate('v', { signal: AbortSignal.abort('why') })],
  [
    'tp.setInterval aborted',
    async () => {
      for await (const _ of tp.setInterval(1, 'i', { signal: AbortSignal.abort() }));
    },
  ],
  ['tp.setTimeout delay string', () => tp.setTimeout('x', 'v')],
  ['tp.setTimeout options null', () => tp.setTimeout(1, 'v', null)],
  ['tp.setTimeout ref 1', () => tp.setTimeout(1, 'v', { ref: 1 })],
  [
    'fs.readFile cb aborted',
    () =>
      new Promise((res, rej) =>
        fs.readFile('f.txt', { signal: AbortSignal.abort() }, (e, d) =>
          e ? rej(e) : res(String(d)),
        ),
      ),
  ],
  [
    'fs.readFile cb abort after call',
    () =>
      new Promise((res, rej) => {
        const ac = new AbortController();
        fs.readFile('f.txt', { signal: ac.signal }, (e, d) => (e ? rej(e) : res(String(d))));
        ac.abort();
      }),
  ],
  [
    'fs.readFile signal {}',
    () =>
      new Promise((res, rej) =>
        fs.readFile('f.txt', { signal: {} }, (e, d) => (e ? rej(e) : res(String(d)))),
      ),
  ],
  [
    'fs.promises.readFile aborted',
    () => fs.promises.readFile('f.txt', { signal: AbortSignal.abort() }).then(String),
  ],
  [
    'fs.promises.writeFile aborted',
    () =>
      fs.promises
        .writeFile('g.txt', 'x', { signal: AbortSignal.abort() })
        .then(() => `wrote ${fs.existsSync('g.txt')}`),
  ],
  [
    'fs.writeFile cb aborted',
    () =>
      new Promise((res, rej) =>
        fs.writeFile('h.txt', 'x', { signal: AbortSignal.abort() }, (e) =>
          e ? rej(e) : res(`wrote ${fs.existsSync('h.txt')}`),
        ),
      ),
  ],
  [
    'fs.promises.appendFile aborted',
    () => fs.promises.appendFile('i.txt', 'x', { signal: AbortSignal.abort() }).then(() => 'wrote'),
  ],
  [
    'fs.writeFile cb abort after call',
    () =>
      new Promise((res) => {
        const ac = new AbortController();
        fs.writeFile('j.txt', 'xyz', { signal: ac.signal }, (e) =>
          res(`${e?.code} size=${fs.statSync('j.txt').size}`),
        );
        ac.abort();
      }),
  ],
  [
    'fs.promises.writeFile abort in a microtask',
    () => {
      const ac = new AbortController();
      const p = fs.promises.writeFile('k.txt', 'xyz', { signal: ac.signal });
      queueMicrotask(() => ac.abort());
      return p.then(
        () => `ok size=${fs.statSync('k.txt').size}`,
        (e) => `${e.code} size=${fs.statSync('k.txt').size}`,
      );
    },
  ],
];
(async () => {
  fs.writeFileSync('f.txt', 'abc');
  for (const [n, f] of rows) {
    let o;
    try {
      o = `ok ${await Promise.race([f(), new Promise((r) => setTimeout(r, 300, 'PENDING'))])}`;
    } catch (e) {
      o = `throw ${t(e)}`;
    }
    console.log(`${n} => ${o}`);
  }
})();
