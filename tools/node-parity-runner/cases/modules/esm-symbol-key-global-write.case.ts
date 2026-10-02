import type { ParityCase } from '../../src/types.ts';

// runtime-js/symbol-key-global-write-guard-precision (ESM side): a computed
// key bound to a Symbol value can never be the string 'Function'.
// @vitest/utils/dist/timers.js does exactly this shape.
const c: ParityCase = {
  kind: 'esm',
  code: `
    const SAFE_TIMERS_SYMBOL = Symbol.for('nodejs.util.inspect.custom');
    const timers = { setTimeout() {}, clearTimeout() {} };
    globalThis[SAFE_TIMERS_SYMBOL] = timers;
    console.log(Object.is(globalThis[SAFE_TIMERS_SYMBOL], timers));
  `,
};

export default c;