import type { ParityCase } from '../../src/types.ts';

/**
 * `Duplex.from(src)` over its non-function source shapes: an array, an
 * async-iterable, a `{readable, writable}` pair (all `instanceof Duplex`), and a
 * loud `ERR_INVALID_ARG_TYPE` throw for an unknown shape. Asserted head-to-head
 * vs Node. (The async-generator-FUNCTION source is `duplex-from-fn.case`, split
 * so each keeps one short async tail for the in-process harness drain.)
 */
const c: ParityCase = {
  expected: [
    'badarg:TypeError:ERR_INVALID_ARG_TYPE',
    'pair-instance:true',
    'asynciter-instance:true',
    'arr-instance:true',
    'arr-objectmode:true',
    'sources-settled:true',
    'asynciter-data:["g1","g2"]',
    'arr-data:["x","y"]',
    'string-source:object=true hwm=16 data=["hé"]',
    'empty-string-source:object=true hwm=16 data=[""]',
    'buffer-source:object=true hwm=16 data=0102 same=true',
  ].join('\n'),
  code: `
    const { Buffer } = require('node:buffer');
    const { Duplex, Readable, Writable } = require('node:stream');
    (async () => {
      function collect(stream) {
        const out = [];
        const done = new Promise((resolve, reject) => {
          stream.on('data', (chunk) => out.push(chunk));
          stream.on('end', resolve);
          stream.on('error', reject);
        });
        return { out, done };
      }

      function settleAll(promises) {
        let timer;
        return Promise.race([
          Promise.all(promises).then(() => {
            clearTimeout(timer);
            return true;
          }),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), 250);
          }),
        ]);
      }

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
      const genResult = collect(dGen);

      // array source.
      const dArr = Duplex.from(['x', 'y']);
      console.log('arr-instance:' + (dArr instanceof Duplex));
      console.log('arr-objectmode:' + dArr.readableObjectMode);
      const arrResult = collect(dArr);

      const dString = Duplex.from('hé');
      const stringResult = collect(dString);

      const dEmpty = Duplex.from('');
      const emptyResult = collect(dEmpty);

      const bufferInput = Buffer.from([1, 2]);
      const dBuffer = Duplex.from(bufferInput);
      const bufferResult = collect(dBuffer);

      const settled = await settleAll([
        genResult.done,
        arrResult.done,
        stringResult.done,
        emptyResult.done,
        bufferResult.done,
      ]);
      console.log('sources-settled:' + settled);
      console.log('asynciter-data:' + JSON.stringify(genResult.out));
      console.log('arr-data:' + JSON.stringify(arrResult.out));
      console.log(
        'string-source:object=' + dString.readableObjectMode +
        ' hwm=' + dString.readableHighWaterMark +
        ' data=' + JSON.stringify(stringResult.out)
      );
      console.log(
        'empty-string-source:object=' + dEmpty.readableObjectMode +
        ' hwm=' + dEmpty.readableHighWaterMark +
        ' data=' + JSON.stringify(emptyResult.out)
      );
      console.log(
        'buffer-source:object=' + dBuffer.readableObjectMode +
        ' hwm=' + dBuffer.readableHighWaterMark +
        ' data=' + bufferResult.out.map((c) => Buffer.from(c).toString('hex')).join(',') +
        ' same=' + (bufferResult.out[0] === bufferInput)
      );
    })();
  `,
};

export default c;
