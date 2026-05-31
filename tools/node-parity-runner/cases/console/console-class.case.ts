import type { ParityCase } from '../../src/types.ts';

// `node:console` `Console` class parity. This is the surface undici's
// `lib/mock/pending-interceptors-formatter.js` exercises: it constructs
// `new Console({ stdout, inspectOptions })` over a `Transform` and renders a
// table with `logger.table(rows)`. We drive the same shape head-to-head
// against real Node.
//
// We cannot compare global-console stdout here (the parity runner replaces the
// global `console.*` methods), so we route each `Console` instance at a custom
// writable, capture its bytes, and print the captured strings via the
// (replaced) global `console.log` — which the runner DOES capture. This
// isolates the `node:console` class behaviour from the runner's global handling.
//
// Capture is async: rifty's `node:stream.Writable` flushes through a microtask
// (it is not a synchronous passthrough), so the case resolves each capture from
// the per-chunk write callback rather than reading the sink synchronously. Node
// flushes its in-process writable synchronously, but the same await is harmless
// there — both runtimes therefore observe the fully-drained output.
const c: ParityCase = {
  code: `
    const { Console } = require('node:console');
    const { Writable } = require('node:stream');

    // Run \`fn(logger)\` against a fresh Console whose stdout collects chunks,
    // resolving once a chunk has been written (one log/table call = one chunk).
    function cap(fn) {
      return new Promise((resolve) => {
        let out = '';
        const w = new Writable({
          write(chunk, _enc, cb) { out += chunk; cb(); resolve(out); },
        });
        const logger = new Console({ stdout: w, inspectOptions: { colors: false } });
        fn(logger);
      });
    }

    (async () => {
      const log = [];
      log.push(['has-Console', typeof Console]);

      // console.log printf + object inspection through the instance.
      log.push(['log', await cap((c) => c.log('hi %s', { a: 1 }))]);
      log.push(['log-multi', await cap((c) => c.log('x', 1, true, null))]);

      // console.table — the undici code path. Array of objects (union of keys).
      log.push(['table-objs', await cap((c) => c.table([{ Method: 'GET', Path: '/a' }, { Method: 'POST', Path: '/bb', Extra: 1 }]))]);
      // Array of primitives -> Values column.
      log.push(['table-prims', await cap((c) => c.table(['apple', 'banana']))]);
      // Object map of objects -> index = own keys.
      log.push(['table-map', await cap((c) => c.table({ x: { a: 1 }, y: { a: 2, b: 3 } }))]);
      // Non-tabular input -> falls back to console.log.
      log.push(['table-nontabular', await cap((c) => c.table(42))]);

      console.log(JSON.stringify(log));
    })();
  `,
};

export default c;
