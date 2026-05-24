import type { ParityCase } from '../../src/types.ts';

/**
 * `pipeline()` with three stages plus a tap Transform that records pass-through
 * counts. The existing `pipeline-transform.case.ts` only proves a single
 * Transform plugs in; this one stresses ordering, multi-Transform chaining, and
 * the final completion callback firing exactly once on success.
 */
const c: ParityCase = {
  code: `
    const { Readable, Transform, Writable, pipeline } = require('node:stream');

    let tapCount = 0;
    const tap = new Transform({
      transform(chunk, _enc, cb) {
        tapCount++;
        cb(null, chunk);
      },
    });
    const upper = new Transform({
      transform(chunk, _enc, cb) {
        cb(null, String(chunk).toUpperCase());
      },
    });
    const collected = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        collected.push(String(chunk));
        cb();
      },
    });

    let cbCount = 0;
    pipeline(
      Readable.from(['hello', ' ', 'world']),
      tap,
      upper,
      sink,
      (err) => {
        cbCount++;
        if (err) console.log('err:' + err.message);
        else {
          console.log('result:' + collected.join(''));
          console.log('tap:' + tapCount);
          console.log('cb:' + cbCount);
        }
      },
    );
  `,
};

export default c;
