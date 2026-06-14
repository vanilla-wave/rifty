import type { ParityCase } from '../../src/types.ts';

// T19 — `describeNonObject` fidelity. `runInContext`/`Script.runInContext` reject a
// non-object context arg with Node's exact ERR_INVALID_ARG_TYPE message. The tail
// per type (verified byte-for-byte vs real Node v24): `undefined`/`null` render
// BARE; a bigint keeps its `n` suffix; `-0` stays `-0`; a string is quote-selected
// ('…' default, "…" when it holds a single quote) + truncated >28 to 25 + '...'; a
// symbol is its toString; boolean/number are String()-rendered. Default (quickjs)
// engine; the dispatcher guard is engine-agnostic.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const Script = vm.Script;
    const args = [
      undefined, null, 42, 3.14, -0, NaN, Infinity,
      0n, -5n, 9007199254740993n,
      'hi', "it's", 'say "hi"', 'x'.repeat(40),
      true, false, Symbol('s'), Symbol(), Symbol.iterator,
    ];
    const msg = (fn) => { try { fn(); return 'NO THROW'; } catch (e) { return e.message; } };
    for (const a of args) {
      // both entry points share the dispatcher guard
      console.log(msg(() => vm.runInContext('1', a)));
      console.log(msg(() => new Script('1').runInContext(a)));
    }
  `,
};

export default c;
