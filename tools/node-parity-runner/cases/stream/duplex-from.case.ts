import type { ParityCase } from '../../src/types.ts';

/**
 * `Duplex.from(src)` over its non-function source shapes: an array, an
 * async-iterable, a `{readable, writable}` pair (all `instanceof Duplex`), and a
 * loud `ERR_INVALID_ARG_TYPE` throw for an unknown shape. Asserted head-to-head
 * vs Node. (The async-generator-FUNCTION source is `duplex-from-fn.case`, split
 * so each keeps one short async tail for the in-process harness drain.)
 */
const c: ParityCase = {
  code: `
    const { Duplex, Readable, Writable } = require('node:stream');
    (async () => {
      // unknown shape → sync ERR_INVALID_ARG_TYPE.
      let bad = 'no-throw';
      try { Duplex.from(42); } catch (e) { bad = e.constructor.name + ':' + e.code; }
      console.log('badarg:' + bad);

      // { readable, writable } pair.
      const pair = Duplex.from({
        readable: Readable.from(['z'], { objectMode: true }),
        writable: new Writable({ objectMode: true, write(c, e, cb) { cb(); } }),
      });
      console.log('pair-instance:' + (pair instanceof Duplex));

      // async-iterable source.
      async function* gen() { yield 'g1'; yield 'g2'; }
      const dGen = Duplex.from(gen());
      console.log('asynciter-instance:' + (dGen instanceof Duplex));
      const outGen = [];
      dGen.on('data', (c) => outGen.push(c));

      // array source.
      const dArr = Duplex.from(['x', 'y']);
      console.log('arr-instance:' + (dArr instanceof Duplex));
      const outArr = [];
      dArr.on('data', (c) => outArr.push(c));

      await new Promise((r) => setTimeout(r, 15));
      console.log('asynciter-data:' + JSON.stringify(outGen));
      console.log('arr-data:' + JSON.stringify(outArr));
    })();
  `,
};

export default c;
