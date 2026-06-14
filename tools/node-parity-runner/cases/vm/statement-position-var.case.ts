import type { ParityCase } from '../../src/types.ts';

// Regression for two divergences PR #30 review found in CLAIMED-CLOSED areas:
// (1) a top-level `var` as the UNBRACED body of if/else/do-while threw SyntaxError
//     — the completion-neutralising `{ let T = (…); }` block left the source `;`
//     dangling, ending the if/loop early.
// (2) a declaration-only `var <writable-intrinsic>;` shadowed the real intrinsic to
//     `undefined` (the registered no-init var name resolved ahead of the intrinsic).
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const J = (x) => JSON.stringify(x);
    const probe = (label, src) => {
      try {
        console.log(label, 'ok', J(vm.runInNewContext(src, {})));
      } catch (e) {
        console.log(label, 'throw', e.constructor.name);
      }
    };

    // (1) var as the unbraced single-statement body of a control construct
    probe('if-else-cons', 'if (false) var x = 1; else 2;');
    probe('if-else-both', 'if (false) var a = 1; else var b = 2; b');
    probe('if-elseif', 'if (false) var x = 1; else if (true) 2;');
    probe('if-nested', 'if (true) { if (false) var x = 1; else 2; }');
    probe('do-while', 'do var x = 1; while (false); x');
    probe('do-while-noinit', 'var i = 0; do var x; while (i++ < 2); i');
    probe('if-else-destructure', 'if (false) var { a } = { a: 1 }; else var { b } = { b: 2 }; b');
    probe('while-body-var', 'var n = 0; while (n < 2) var w = n++; w');

    // controls: braced bodies + statement-list position keep working
    probe('if-braced', 'if (false) { var x = 1; } else 2;');
    probe('for-body-var', 'for (var i = 0; i < 1; i++) var y = i; y');
    probe('stmt-list', 'var x = 1; x');
    probe('completion-empty', 'var q = 5;');
    probe('multi-decl', 'var a = 1, b = 2; a + b');

    // (2) declaration-only var whose name collides with a writable intrinsic
    probe('var-Map-new', 'var Map; var m = new Map(); m.set("k", 1); m.get("k")');
    probe('var-JSON', 'var JSON; JSON.stringify({ a: 1 })');
    probe('var-Array-typeof', 'var Array; typeof Array');
    probe('var-Map-assign', 'var Map; Map = 7; Map');
    probe('var-Map-assign-undef', 'var Map; Map = undefined; typeof Map');
    probe('var-Map-assign-undef-new', 'var Map; Map = undefined; new Map()');
    probe('var-nonintrinsic', 'var foo; typeof foo');
  `,
};

export default c;
