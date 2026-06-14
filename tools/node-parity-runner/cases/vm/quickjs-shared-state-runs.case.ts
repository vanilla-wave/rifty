import type { ParityCase } from '../../src/types.ts';

// T19 — realistic corpus: two runs share state through ONE persistent context.
// First run seeds a counter + helper on the context global; a later run reads and
// mutates them. Mirrors a REPL / incremental-eval session reusing a context.
// Default (quickjs) engine; Node is the byte-for-byte oracle.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const ctx = vm.createContext({ seed: 10 });
    vm.runInContext('var count = seed; function bump(n) { count += n; return count; }', ctx);
    console.log(vm.runInContext('bump(5)', ctx));
    console.log(vm.runInContext('bump(2)', ctx));
    console.log(vm.runInContext('count', ctx));
    // the host sees the persisted bindings on the context object
    console.log(ctx.count, typeof ctx.bump);
  `,
};

export default c;
