import type { ParityCase } from '../../src/types.ts';

/**
 * `Writable.toWeb(w)` hands a Node `Writable` to a Web API as a real WHATWG
 * `WritableStream`: the writer drives `_write` in order; a withheld `_write` cb
 * (HWM 1) holds the NEXT write's promise pending and its `_write` un-called until
 * the prior cb fires (serialized, drain-gated backpressure). Asserted vs Node.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    (async () => {
      const order = [];
      let firstCb = null;
      const w = new Writable({
        objectMode: true,
        highWaterMark: 1,
        write(chunk, enc, cb) {
          order.push('write:' + chunk);
          if (chunk === 'a') firstCb = cb; else cb();
        },
      });
      const web = Writable.toWeb(w);
      console.log('is-ws:' + (web instanceof WritableStream));
      const writer = web.getWriter();
      const p1 = writer.write('a');
      await new Promise((r) => setTimeout(r, 10));
      let p2settled = false;
      const p2 = writer.write('b').then(() => { p2settled = true; });
      await new Promise((r) => setTimeout(r, 10));
      console.log('writes-before-release:' + JSON.stringify(order.filter((x) => x.startsWith('write:'))));
      console.log('p2-pending:' + (p2settled === false));
      firstCb();
      await p1; await p2;
      console.log('final-order:' + JSON.stringify(order));
    })();
  `,
};

export default c;
