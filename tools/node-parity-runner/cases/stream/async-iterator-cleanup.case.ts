/**
 * Per Node's documented `Readable[Symbol.asyncIterator]` contract:
 *   - listeners attached for the iteration are torn down on completion;
 *   - on early termination (break/return/throw before EOF) the source is
 *     destroyed so producers learn the consumer is gone.
 *
 * We don't assert raw listener counts here — Node implements the iterator
 * via `'readable'` (not `'data'`), so the surface differs. Both runtimes
 * must agree on: (a) the consumed prefix, (b) `destroyed === true` after a
 * break, (c) the `'data'` channel is not left dangling.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      const r = Readable.from((function*() { for (let i = 0; i < 10; i++) yield i; })());
      const out = [];
      for await (const v of r) {
        out.push(v);
        if (out.length >= 3) break;
      }
      // Settle any pending microtasks before reporting.
      await new Promise((resolve) => setImmediate(resolve));
      console.log('consumed:' + out.join(','));
      console.log('data-listeners:' + r.listenerCount('data'));
      console.log('destroyed:' + r.destroyed);
    })();
  `,
};

export default c;
