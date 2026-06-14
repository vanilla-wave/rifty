import type { ParityCase } from '../../src/types.ts';

// T13 — real global-object fidelity for QuickJS vm contexts. The OLD rewrite
// engine (a `with(proxy)+eval` over a plain property bag) could not reproduce a
// real vm global object's attribute / lexical / strict semantics; a QuickJS real
// realm should — mostly BY CONSTRUCTION (real intrinsics, strict mode, lexical
// scope, real global). The membrane seed/sweep layer must not interfere.
//
// Node is the oracle (runner diffs against real Node byte-for-byte). The list
// below is the EXACT divergence class from
// docs/backlog/runtime-js/vm-context-global-object-fidelity.md. Captured via real
// `node` v24.16.0:
//   1. non-writable intrinsics: `var undefined/NaN/Infinity = …` (+ bare `NaN=1`)
//      are silent no-ops; the intrinsic value survives.
//   2. non-configurable var/function binding + delete: `delete d`/`delete f`
//      return false, the binding survives.
//   3. pre-declared lexical intrinsics: `let undefined` / `function undefined(){}`
//      → redeclaration SyntaxError.
//   4. globalThis write-shadow: `var globalThis = 5; globalThis` reads back 5.
//   5. eval name: `var eval = 5; eval` reads back the context var 5.
//   6. strict-mode undeclared write: `"use strict"; xxx = 1` → ReferenceError.
//   7. declaration-only var: `var z;` is a non-config, enumerable own prop on the
//      vm GLOBAL (`this`) — but NOT surfaced on the contextified sandbox object
//      (V8 contextify only copies a global back to the sandbox when its value was
//      actually assigned; a pure declaration whose value stays undefined is not).
//   8. cross-run lexical persistence: top-level `let`/`const`/`class` persist as
//      the context's global lexical bindings across runInContext calls (readable
//      next run; a re-declaration next run is a redeclaration SyntaxError).
const c: ParityCase = {
  code: `
    globalThis.__RIFTY_VM_ENGINE = 'quickjs';
    const vm = require('node:vm');
    const out = [];
    const C = (e) => (e && e.constructor ? e.constructor.name : String(e));

    // 1. non-writable intrinsic globals (silent no-op in sloppy mode)
    {
      const sb = {}; vm.createContext(sb);
      out.push('1a ' + vm.runInContext('var undefined = 5; undefined', sb));
      out.push('1b ' + vm.runInContext('var NaN = 1; NaN', sb));
      out.push('1c ' + vm.runInContext('var Infinity = 0; Infinity', sb));
      out.push('1d ' + vm.runInContext('NaN = 1; NaN', sb));
      out.push('1e keys=' + JSON.stringify(Object.keys(sb)));
    }
    // 2. non-configurable var/function bindings + delete
    {
      const sb = {}; vm.createContext(sb);
      out.push('2a ' + vm.runInContext('var d = 5; delete d; d', sb));
      out.push('2b ' + vm.runInContext('function f(){}; delete f', sb));
      out.push('2c ' + vm.runInContext('typeof f', sb));
    }
    // 3. pre-declared lexical intrinsics -> redeclaration SyntaxError.
    // let-undefined matches both engines (lexical-over-lexical early SyntaxError).
    // function-undefined is the ONE genuine QuickJS-vs-V8 divergence (T19): V8
    // raises an early SyntaxError; QuickJS the spec-literal runtime TypeError from
    // GlobalDeclarationInstantiation. We do NOT fake the error type, so that
    // sub-case is asserted (both engine outputs) in the conformance test, not here.
    {
      const sb = {}; vm.createContext(sb);
      try { vm.runInContext('let undefined = 5', sb); out.push('3a no-throw'); } catch (e) { out.push('3a ' + C(e)); }
    }
    // 4. globalThis write-shadow
    {
      const sb = {}; vm.createContext(sb);
      out.push('4 ' + vm.runInContext('var globalThis = 5; globalThis', sb));
    }
    // 5. eval name shadowing
    {
      const sb = {}; vm.createContext(sb);
      out.push('5 ' + vm.runInContext('var eval = 5; eval', sb));
    }
    // 6. strict-mode undeclared write → ReferenceError
    {
      const sb = {}; vm.createContext(sb);
      try { vm.runInContext('"use strict"; xxx = 1', sb); out.push('6 no-throw'); } catch (e) { out.push('6 ' + C(e)); }
    }
    // 7. declaration-only var own-prop attributes (on the vm GLOBAL, not the sandbox)
    {
      const sb = {}; vm.createContext(sb);
      vm.runInContext('var z;', sb);
      out.push('7a sb.keys=' + JSON.stringify(Object.keys(sb)));
      out.push('7b sb.z=' + sb.z + ' hasOwn=' + Object.prototype.hasOwnProperty.call(sb, 'z'));
      out.push('7c sb.desc=' + JSON.stringify(Object.getOwnPropertyDescriptor(sb, 'z')));
      out.push('7d this.desc=' + vm.runInContext('JSON.stringify(Object.getOwnPropertyDescriptor(this,"z"))', sb));
      out.push('7e this.keys=' + vm.runInContext('JSON.stringify(Object.keys(this))', sb));
      out.push('7f this.hasOwn=' + vm.runInContext('this.hasOwnProperty("z")', sb));
      out.push('7g this.z+in=' + vm.runInContext('[String(this.z), "z" in this].join(",")', sb));
      // a later actual assignment DOES surface on the sandbox
      vm.runInContext('z = 42;', sb);
      out.push('7h after-assign sb.z=' + sb.z + ' keys=' + JSON.stringify(Object.keys(sb)));
    }
    // assigned var / function / this.x / bare-assignment DO propagate to the
    // sandbox; a declaration-only var does NOT. (An explicit var x = undefined
    // initializer is post-run indistinguishable from var x; -- same undefined
    // value + non-configurable binding -- so rifty also skips it; that is the one
    // documented T13 residual, kept out of this byte-matched assertion.)
    {
      const sb = {}; vm.createContext(sb);
      vm.runInContext('var assigned = 5; var declonly; this.tp = 9; bare = 7; function fn(){}', sb);
      out.push('7i sb.keys=' + JSON.stringify(Object.keys(sb).sort()));
      out.push('7j declonly hasOwn=' + Object.prototype.hasOwnProperty.call(sb, 'declonly'));
    }
    // 8. cross-run lexical persistence (let/const/class)
    {
      const sb = {}; vm.createContext(sb);
      vm.runInContext('let persist = 7', sb);
      out.push('8a ' + vm.runInContext('persist', sb));
      try { vm.runInContext('let persist = 8', sb); out.push('8b no-throw'); } catch (e) { out.push('8b ' + C(e)); }
      vm.runInContext('const k = 11', sb);
      out.push('8c ' + vm.runInContext('k', sb));
      try { vm.runInContext('const k = 12', sb); out.push('8d no-throw'); } catch (e) { out.push('8d ' + C(e)); }
      vm.runInContext('class Cls { m(){ return 42; } }', sb);
      out.push('8e ' + vm.runInContext('new Cls().m()', sb));
      try { vm.runInContext('class Cls {}', sb); out.push('8f no-throw'); } catch (e) { out.push('8f ' + C(e)); }
      out.push('8g sb.keys=' + JSON.stringify(Object.keys(sb)));
      out.push('8h sb.persist=' + sb.persist);
    }
    console.log(out.join('\\n'));
  `,
  expected:
    '1a undefined\n' +
    '1b NaN\n' +
    '1c Infinity\n' +
    '1d NaN\n' +
    '1e keys=[]\n' +
    '2a 5\n' +
    '2b false\n' +
    '2c function\n' +
    '3a SyntaxError\n' +
    '4 5\n' +
    '5 5\n' +
    '6 ReferenceError\n' +
    '7a sb.keys=[]\n' +
    '7b sb.z=undefined hasOwn=false\n' +
    '7c sb.desc=undefined\n' +
    '7d this.desc={"writable":true,"enumerable":true,"configurable":false}\n' +
    '7e this.keys=["z"]\n' +
    '7f this.hasOwn=true\n' +
    '7g this.z+in=undefined,true\n' +
    '7h after-assign sb.z=42 keys=["z"]\n' +
    '7i sb.keys=["assigned","bare","fn","tp"]\n' +
    '7j declonly hasOwn=false\n' +
    '8a 7\n' +
    '8b SyntaxError\n' +
    '8c 11\n' +
    '8d SyntaxError\n' +
    '8e 42\n' +
    '8f SyntaxError\n' +
    '8g sb.keys=[]\n' +
    '8h sb.persist=undefined\n',
};

export default c;
