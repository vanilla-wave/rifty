import type { ParityCase } from '../../src/types.ts';

// Closes the runtime-js/vm-sandbox-residual-gaps backlog item (ADR-0138): top-level
// function hoisting, declaration-statement completion values, statement-position
// `var` destructuring patterns, and post-run persistence of context `var` bindings.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const J = (x) => JSON.stringify(x);

    // --- top-level function hoisting (callable before its declaration) ---
    {
      const ctx = {};
      const r = vm.runInNewContext('var r = f(); function f(){ return 9; } r;', ctx);
      console.log('hoist', J(r), typeof ctx.f);
    }
    // mutual recursion across two hoisted top-level functions
    {
      const ctx = {};
      const r = vm.runInNewContext(
        'function a(n){ return n <= 0 ? 0 : b(n - 1); } function b(n){ return a(n) + 1; } a(3);',
        ctx,
      );
      console.log('mutual', J(r));
    }
    // reassigning a top-level function name lands on the context, shadowing the fn
    {
      const ctx = {};
      const r = vm.runInNewContext('function f(){ return 1; } f = 5; f;', ctx);
      console.log('reassign', J(r), J(ctx.f));
    }

    // --- completion values: declarations have empty completion ---
    console.log('compl-var', J(vm.runInNewContext('var q = 5;', {})));
    console.log('compl-1var', J(vm.runInNewContext('1; var w = 7;', {})));
    console.log('compl-9varz', J(vm.runInNewContext('9; var z;', {})));
    console.log('compl-fn', J(vm.runInNewContext('function f(){}', {})));
    console.log('compl-5fn', J(vm.runInNewContext('5; function f(){}', {})));
    console.log('compl-multi', J(vm.runInNewContext('var a = 1, b = 2;', {})));
    console.log('compl-forvar', J(vm.runInNewContext('for (var i = 0; i < 3; i++) i;', {})));

    // --- statement-position var destructuring patterns ---
    {
      const ctx = {};
      const r = vm.runInNewContext(
        'var { a, b = 2, ...rest } = { a: 1, c: 3, d: 4 }; var [x, , y = 9] = [10]; ({ a, b, rest, x, y });',
        ctx,
      );
      console.log('destruct', J(r), J(Object.keys(ctx).sort()));
    }
    {
      const ctx = {};
      const r = vm.runInNewContext('var { p: { q } } = { p: { q: 5 } }; ({ q });', ctx);
      console.log('destruct-nested', J(r), 'q' in ctx, 'p' in ctx);
    }

    // --- post-run persistence: a captured closure still reads context vars ---
    {
      const ctx = {};
      vm.runInNewContext('var unset; this.read = function(){ return unset; };', ctx);
      console.log('postrun-bare', String(ctx.read()), typeof ctx.read());
    }
    {
      globalThis.__riftyVmGapShadow = 'HOST';
      const ctx = {};
      vm.runInNewContext('var __riftyVmGapShadow; this.read = function(){ return __riftyVmGapShadow; };', ctx);
      console.log('postrun-shadow', String(ctx.read()), typeof ctx.read());
      delete globalThis.__riftyVmGapShadow;
    }
    // a var declared in one run stays readable (undefined) in later runs of the same ctx
    {
      const ctx = vm.createContext({});
      vm.runInContext('var later;', ctx);
      console.log('persist-run2', J(vm.runInContext('typeof later;', ctx)));
    }

    // --- regression coverage for var rewrite shapes that share edit offsets ---
    {
      const ctx = {};
      const r = vm.runInNewContext('for (var { a } of [{ a: 1 }, { a: 2 }]) ; for (var [x, y] of [[3, 4]]) ; ({ a, x, y });', ctx);
      console.log('for-of-pat', J(r), J(ctx));
    }
    {
      const ctx = {};
      const r = vm.runInNewContext('var out = []; for (var i = 0, j = 10; i < 2; i++, j--) out.push(i + ":" + j); ({ out, i, j });', ctx);
      console.log('for-init-multi', J(r));
    }
    {
      const ctx = {};
      const r = vm.runInNewContext('if (true) var q = 3; { var bv = 9; } ({ q, bv });', ctx);
      console.log('var-positions', J(r));
    }
    {
      const ctx = {};
      const r = vm.runInNewContext('function outer() { var local = 1; return local; } ({ r: outer(), leak: typeof local });', ctx);
      console.log('nested-local', J(r), 'local' in ctx);
    }

    // --- parenthesised last var initializer (acorn strips the wrapping parens) ---
    console.log('paren-seq', J(vm.runInNewContext('var c = (1, 2, 3); c', {})));
    console.log('paren-completion', J(vm.runInNewContext('var z = (9)', {})));
    console.log('paren-nested', J(vm.runInNewContext('var c = (((7))); c', {})));
    console.log('paren-arrow', J(vm.runInNewContext('var f = (a => a + 1); f(4)', {})));
    console.log('paren-obj', J(vm.runInNewContext('var o = ({ a: 1 }); o.a', {})));
    {
      const ctx = {};
      const r = vm.runInNewContext('var b = 2, { x } = ({ x: 9 }); var [y] = ([10]); ({ b, x, y });', ctx);
      console.log('paren-pat', J(r), J(Object.keys(ctx).sort()));
    }
    console.log('paren-forinit', J(vm.runInNewContext('var s = 0; for (var i = (0); i < 3; i++) s += i; s', {})));
  `,
};

export default c;
