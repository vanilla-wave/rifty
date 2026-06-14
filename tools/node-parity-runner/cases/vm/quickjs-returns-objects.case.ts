import type { ParityCase } from '../../src/types.ts';

// T6 — guest→host membrane for OBJECT / FUNCTION / ARRAY completion values.
// Node is the oracle (parity runner diffs against real Node byte-for-byte).
// The membrane wraps guest values so that:
//   - arrays:    Array.isArray TRUE but `instanceof Array` FALSE (cross-realm),
//   - objects:   constructor !== host Object, NOT instanceof host Object, keys/JSON work,
//   - functions: typeof 'function', callable, NOT instanceof host Function.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const arr = vm.runInNewContext('[1,2,3]');
    console.log(arr instanceof Array, Array.isArray(arr), JSON.stringify(arr));
    const obj = vm.runInNewContext('({a:1,b:2})');
    console.log(obj.constructor === Object, obj instanceof Object, obj.a, Object.keys(obj).join(','));
    const fn = vm.runInNewContext('(function(x){return x+1})');
    console.log(typeof fn, fn(41), fn instanceof Function);
  `,
  expected: 'false true [1,2,3]\nfalse false 1 a,b\nfunction 42 false\n',
};

export default c;
