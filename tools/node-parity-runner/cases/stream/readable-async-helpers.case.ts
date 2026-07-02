import type { ParityCase } from '../../src/types.ts';

/**
 * `Readable.prototype` async-iterator helpers (v17→v22): placement, return
 * types, and the core outputs of `map`/`filter`/`flatMap`/`take`/`drop`/
 * `reduce`/`some`/`every`/`find`/`forEach`/`toArray`. Asserted head-to-head
 * against real Node.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      // Placement on the prototype.
      const names = ['map','filter','forEach','reduce','toArray','take','drop','flatMap','some','every','find','iterator'];
      console.log('proto:' + names.map((n) => typeof Readable.prototype[n]).join(','));

      // Stream-returning helpers → objectMode Readable.
      const m = Readable.from([1, 2, 3]).map((x) => x * 2);
      console.log('map-readable:' + (m instanceof Readable) + ':' + m.readableObjectMode);

      // Outputs.
      console.log('map:' + JSON.stringify(await Readable.from([1, 2, 3]).map((x) => x * 2).toArray()));
      console.log('filter:' + JSON.stringify(await Readable.from([1, 2, 3, 4]).filter((x) => x % 2 === 0).toArray()));
      console.log('flatMap:' + JSON.stringify(await Readable.from([1, 2]).flatMap((x) => [x, x * 10]).toArray()));
      console.log('take2:' + JSON.stringify(await Readable.from([1, 2, 3, 4]).take(2).toArray()));
      console.log('take10:' + JSON.stringify(await Readable.from([1, 2, 3]).take(10).toArray()));
      console.log('drop2:' + JSON.stringify(await Readable.from([1, 2, 3, 4]).drop(2).toArray()));
      console.log('drop0:' + JSON.stringify(await Readable.from([1, 2, 3]).drop(0).toArray()));
      console.log('drop10:' + JSON.stringify(await Readable.from([1, 2, 3]).drop(10).toArray()));
      console.log('reduce-init:' + (await Readable.from([1, 2, 3]).reduce((a, b) => a + b, 0)));
      console.log('reduce-noinit:' + (await Readable.from([1, 2, 3]).reduce((a, b) => a + b)));
      console.log('some:' + (await Readable.from([1, 2, 3]).some((x) => x === 2)));
      console.log('some-false:' + (await Readable.from([1, 2, 3]).some((x) => x > 10)));
      console.log('every:' + (await Readable.from([1, 2, 3]).every((x) => x > 0)));
      console.log('find:' + (await Readable.from([1, 2, 3]).find((x) => x > 1)));
      console.log('find-undef:' + (await Readable.from([1, 2, 3]).find((x) => x > 10)));
      console.log('forEach:' + (await Readable.from([1, 2, 3]).forEach(() => {})));
      console.log('chain:' + JSON.stringify(await Readable.from([1, 2, 3, 4]).map((x) => x * 2).filter((x) => x > 4).toArray()));
    })();
  `,
};

export default c;
