import type { ParityCase } from '../../src/types.ts';

/**
 * `map(fn, { concurrency: 2 })` over `[1,2,3,4]` with descending per-item delays
 * keeps OUTPUT in INPUT order (`[10,20,30,40]`) even though completion is
 * concurrent (the first item to finish is NOT input #1). The exact completion
 * sequence has sub-tick jitter at these short delays (kept short for the
 * in-process harness drain), so this case asserts the two DETERMINISTIC facts —
 * output order + concurrency-is-real — head-to-head against real Node; the unit
 * test pins the full completion order with larger delays.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      const completion = [];
      const out = await Readable.from([1, 2, 3, 4]).map(async (x) => {
        await delay((5 - x) * 4);
        completion.push(x);
        return x * 10;
      }, { concurrency: 2 }).toArray();
      console.log('out:' + JSON.stringify(out));
      // Concurrency real: input #1 (slowest) is not the first to complete.
      console.log('concurrent:' + (completion[0] !== 1));
      console.log('all-completed:' + (completion.length === 4));
    })();
  `,
};

export default c;
