import type { ParityCase } from '../../src/types.ts';

// REWRITE-engine opt-in floor guard (T17 cutover). Forces `__RIFTY_VM_ENGINE=
// 'rewrite'` and asserts the hardened-rewrite engine stays Node-correct for the
// bulk of ordinary syntax it was built for — top-level function hoisting,
// declaration-statement completion values, statement-position `var` destructuring,
// unbraced-control-body `var`, declaration-only intrinsic shadowing, and cross-run
// var persistence. These all also pass on the default quickjs engine; this case is
// the floor guarantee that the rewrite opt-in remains shippable.
const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'rewrite';
    const vm = require('node:vm');
    const J = (x) => JSON.stringify(x);
    const probe = (label, src) => {
      try { console.log(label, 'ok', J(vm.runInNewContext(src, {}))); }
      catch (e) { console.log(label, 'throw', e.constructor.name); }
    };

    // top-level function hoisting (callable before its declaration)
    {
      const ctx = {};
      const r = vm.runInNewContext('var r = f(); function f(){ return 9; } r;', ctx);
      console.log('hoist', J(r), typeof ctx.f);
    }
    // declaration-statement completion values
    probe('compl-var', 'var q = 5;');
    probe('compl-1var', '1; var w = 7;');
    probe('compl-fn', 'function f(){}');
    probe('compl-5fn', '5; function f(){}');
    probe('compl-multi', 'var a = 1, b = 2;');
    probe('stmt-val', 'var x = 5; x;');

    // statement-position var destructuring lands on the context
    {
      const ctx = {};
      const r = vm.runInNewContext('var { a, b = 2, ...rest } = { a: 1, c: 3 }; var [x, , y = 9] = [10]; ({ a, b, rest, x, y });', ctx);
      console.log('destruct', J(r), J(Object.keys(ctx).sort()));
    }

    // unbraced-control-body var (PR #30 regression)
    probe('if-else-cons', 'if (false) var x = 1; else 2;');
    probe('do-while', 'do var x = 1; while (false); x');

    // declaration-only var of a writable-intrinsic name leaves the intrinsic intact
    probe('var-Map-new', 'var Map; var m = new Map(); m.set("k", 1); m.get("k")');
    probe('var-Map-assign', 'var Map; Map = 7; Map');

    // cross-run var persistence in a reused context
    {
      const ctx = vm.createContext({});
      vm.runInContext('var later;', ctx);
      console.log('persist', J(vm.runInContext('typeof later;', ctx)));
    }

    // a non-contextified object is rejected with the shared dispatcher guard
    try { vm.runInContext('1 + 1', {}); console.log('reject', 'NO THROW'); }
    catch (e) { console.log('reject', e.name); }
  `,
};

export default c;
