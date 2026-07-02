import type { ParityCase } from '../../src/types.ts';

/**
 * Async-iterator helper validation + errors (head-to-head vs real Node):
 *   - `take(-1)`/`drop(-1)` → `ERR_OUT_OF_RANGE` (RangeError, sync);
 *   - `reduce` of an EMPTY stream with no init → rejects `ERR_MISSING_ARGS`
 *     (TypeError);
 *   - `map(non-fn)` → `ERR_INVALID_ARG_TYPE` (TypeError, sync);
 *   - a callback throw fails fast (`toArray` rejects with the SAME error);
 *   - concurrency 0/-1/'x' → `ERR_OUT_OF_RANGE`; 1.5 accepted.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const codeOf = (fn) => { try { fn(); return 'no-throw'; } catch (e) { return e.constructor.name + ':' + e.code; } };
    (async () => {
      console.log('take-neg:' + codeOf(() => Readable.from([1]).take(-1)));
      console.log('drop-neg:' + codeOf(() => Readable.from([1]).drop(-1)));
      console.log('map-nonfn:' + codeOf(() => Readable.from([1]).map(42)));
      console.log('conc-0:' + codeOf(() => Readable.from([1]).map((x) => x, { concurrency: 0 })));
      console.log('conc-neg:' + codeOf(() => Readable.from([1]).map((x) => x, { concurrency: -1 })));
      console.log('conc-str:' + codeOf(() => Readable.from([1]).map((x) => x, { concurrency: 'x' })));

      let reduceErr = 'no-reject';
      try { await Readable.from([]).reduce((a, b) => a + b); }
      catch (e) { reduceErr = (e instanceof TypeError) + ':' + e.code; }
      console.log('reduce-empty:' + reduceErr);

      const boom = new Error('cb-throw');
      let mapThrow = 'no-reject';
      try { await Readable.from([1, 2, 3]).map((x) => { if (x === 2) throw boom; return x; }).toArray(); }
      catch (e) { mapThrow = (e === boom) ? 'same' : 'diff'; }
      console.log('map-throw:' + mapThrow);

      console.log('conc-1.5:' + JSON.stringify(await Readable.from([1, 2]).map((x) => x, { concurrency: 1.5 }).toArray()));
    })();
  `,
};

export default c;
