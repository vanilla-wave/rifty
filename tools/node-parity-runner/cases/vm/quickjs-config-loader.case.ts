import type { ParityCase } from '../../src/types.ts';

// T19 — realistic corpus: the npm "config / plugin loader" pattern. A host
// `module` object is seeded into a context; guest code assigns `module.exports`
// to a structured plugin config (array + nested object + a method); the host
// then reads it back, calls the method, and serialises it. Exercises nested
// write-back + a guest callable invoked from the host across the membrane.
// Default (quickjs) engine; Node is the byte-for-byte oracle.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const m = { exports: {} };
    const ctx = vm.createContext({ module: m });
    vm.runInContext(
      'module.exports = { plugins: ["a", "b"], nested: { a: 1, deep: { z: true } }, fn() { return 2; } };',
      ctx,
    );
    const exp = m.exports;
    console.log(exp.plugins.join(','));
    console.log(exp.nested.a, exp.nested.deep.z);
    console.log(typeof exp.fn, exp.fn());
    console.log(JSON.stringify(exp));
  `,
};

export default c;
