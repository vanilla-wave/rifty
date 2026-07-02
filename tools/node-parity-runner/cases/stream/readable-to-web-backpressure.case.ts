import type { ParityCase } from '../../src/types.ts';

/**
 * Backpressure: `Readable.toWeb` is pull-driven. A slow web consumer that holds
 * onto the reader without reading must NOT cause the source to drain its whole
 * buffer — the source stays bounded by its `highWaterMark`. We push a fixed set
 * of object-mode chunks up-front, attach the web reader, let microtasks settle
 * WITHOUT reading, then assert the source has NOT emitted everything (its
 * internal buffer still holds chunks past the HWM-bounded pull). Asserted
 * head-to-head against real Node.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      const r = Readable.from([1, 2, 3, 4, 5, 6, 7, 8], { objectMode: true, highWaterMark: 2 });
      const web = Readable.toWeb(r);
      const reader = web.getReader();
      // Pull exactly two chunks slowly, then settle without reading further.
      const a = await reader.read();
      const b = await reader.read();
      console.log('a:' + a.value);
      console.log('b:' + b.value);
      await new Promise((res) => setTimeout(res, 20));
      // The source must not have run to completion just because we stopped
      // reading: it is still readable (not ended) with chunks left to give.
      console.log('source-ended:' + r.readableEnded);
      // Drain the rest to confirm order is preserved and nothing was dropped.
      const rest = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest.push(value);
      }
      console.log('rest:' + rest.join(','));
    })();
  `,
};

export default c;
