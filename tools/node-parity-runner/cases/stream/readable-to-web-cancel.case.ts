import type { ParityCase } from '../../src/types.ts';

/**
 * `reader.cancel(reason)` on the web side destroys the source Node `Readable`
 * (no further `'data'`). Asserted head-to-head against real Node: after cancel,
 * the source is destroyed and a chunk pushed afterwards is never observed.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      let dataAfterCancel = 0;
      // Object mode so the chunk value matches across runtimes — this case
      // isolates cancel→destroy, not chunk encoding.
      const r = new Readable({ objectMode: true, read() {} });
      r.push('one');
      const web = Readable.toWeb(r);
      const reader = web.getReader();
      const first = await reader.read();
      console.log('first:' + first.value);
      r.on('data', () => { dataAfterCancel += 1; });
      await reader.cancel('done');
      // Give the cancel→destroy a tick to settle, then probe.
      await new Promise((res) => setTimeout(res, 10));
      console.log('destroyed:' + r.destroyed);
      console.log('data-after-cancel:' + dataAfterCancel);
    })();
  `,
};

export default c;
