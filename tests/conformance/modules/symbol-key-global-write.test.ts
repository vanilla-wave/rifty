/**
 * Symbol-key global-write guard precision (vitest-run-in-browser, I6):
 * a provably Symbol-valued computed key can never be the string 'Function'
 * (nor 'eval'), so the Function-assignment ceiling must not fire on the
 * @vitest/utils / undici shapes. The ceiling is UNCHANGED for every key that
 * may be 'Function' — string literals, concatenations, unknown identifiers,
 * `let`-bound symbols, and shadowed `Symbol` stay loud.
 */
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('provably-Symbol computed keys bypass the Function guard', () => {
  const allowedEsm: Record<string, string> = {
    '/const-alias-write.mjs': `
      const SAFE = Symbol.for('vitest:utils:SAFE_TIMERS');
      globalThis[SAFE] = { tag: 'stash' };
      export const r = globalThis[SAFE].tag;
    `,
    '/direct-for-write.mjs': `
      globalThis[Symbol.for('direct')] = 1;
      export const r = globalThis[Symbol.for('direct')];
    `,
    '/symbol-call-write.mjs': `
      const K = Symbol('local');
      globalThis[K] = 2;
      export const r = globalThis[K];
    `,
    '/method-call-on-stash.mjs': `
      const K = Symbol.for('timers');
      globalThis[K] = { ping() { return 'pong'; } };
      export const r = globalThis[K].ping();
    `,
    '/define-property-alias.mjs': `
      const D = Symbol.for('undici.globalDispatcher.2');
      Object.defineProperty(globalThis, D, { value: 'dp', configurable: true });
      export const r = globalThis[D];
    `,
    '/define-properties-computed.mjs': `
      const K = Symbol.for('dp2');
      Object.defineProperties(globalThis, { [K]: { value: 5, configurable: true } });
      export const r = globalThis[K];
    `,
    '/object-assign-computed.mjs': `
      const K = Symbol.for('assign');
      Object.assign(globalThis, { [K]: 6 });
      export const r = globalThis[K];
    `,
    '/reflect-set-alias.mjs': `
      const K = Symbol.for('reflect');
      Reflect.set(globalThis, K, 7);
      export const r = globalThis[K];
    `,
    '/delete-alias.mjs': `
      const K = Symbol.for('del');
      globalThis[K] = 8;
      delete globalThis[K];
      export const r = typeof globalThis[K];
    `,
    '/reflect-delete-alias.mjs': `
      const K = Symbol.for('rdel');
      globalThis[K] = 9;
      Reflect.deleteProperty(globalThis, K);
      export const r = typeof globalThis[K];
    `,
    '/export-wrapped-alias.mjs': `
      export const K = Symbol.for('exported');
      globalThis[K] = 10;
      export const r = globalThis[K];
    `,
    // Scope control for the tamper boundary: mutating a SHADOWED local
    // Symbol (a parameter) is not intrinsic substitution — the module's own
    // provable keys stay exempt. Kills a scope-insensitive tamper mutant.
    '/shadowed-local-mutation.mjs': `
      function f(Symbol) {
        Symbol.for = () => 'tampered-sentinel';
      }
      f({ for: () => 'x' });
      const K = Symbol.for('scope.control');
      globalThis[K] = 11;
      export const r = globalThis[K];
      delete globalThis[K];
    `,
    // Source-order control (Final+GREEN R2 C1): a genuine Symbol-key write
    // BEFORE any tamper is legitimate — the key was a real Symbol at write
    // time. Kills a whole-module pre-scan mutant (tamper flagged regardless
    // of order would wrongly reject the pre-tamper write).
    '/write-before-tamper.mjs': `
      const originalFor = Symbol.for;
      const K = Symbol.for('write.before.tamper');
      globalThis[K] = 12;
      Symbol.for = () => 'tampered-sentinel';
      Symbol.for = originalFor;
      export const r = globalThis[K];
      delete globalThis[K];
    `,
    // Nested-scope control (Final+GREEN R3 F3): a tamper-shaped assignment
    // inside a KEY expression but scoped to a nested function's OWN Symbol
    // binding is a local mutation — the real intrinsic is untouched and the
    // key stays provable. Kills a scope-insensitive key-scan mutant.
    '/key-nested-local-symbol.mjs': `
      const K = Symbol.for('key.nested.local');
      globalThis[((Symbol) => { Symbol.for = () => 'tampered-sentinel'; })({ for: () => 'z' }), K] = 13;
      export const r = globalThis[K];
      delete globalThis[K];
    `,
    // Early-walk scope control (Final+GREEN R4 C1): same nested local
    // mutation, but the provable key is a FRESH Symbol.for call after it —
    // a scope-insensitive early walk would flag tamper and fail this proof.
    '/key-fresh-after-nested-local.mjs': `
      globalThis[((Symbol) => { Symbol.for = () => 'inner'; })({ for: () => 'z' }), Symbol.for('c1.fresh')] = 14;
      export const r = globalThis[Symbol.for('c1.fresh')];
      delete globalThis[Symbol.for('c1.fresh')];
    `,
    // Replay control (Final+GREEN R4 F2): the early key walk must not leak
    // alias marks into the in-order re-walk — `g.Function = 1` runs while g
    // is a LOCAL object (Node: 22); a leaked `g = globalThis` mark would
    // wrongly turn it into a host Function write on replay.
    '/key-alias-replay.mjs': `
      let g = {};
      globalThis[Symbol.for((g.Function = 1, g = globalThis, 'f2.esm'))] = 22;
      export const r = globalThis[Symbol.for('f2.esm')];
      delete globalThis[Symbol.for('f2.esm')];
    `,
    // Edit-free twin of the CJS R4 F1 pin: a key-interior Function
    // reference stays routed, the write runs (ESM pushes no edits).
    '/key-function-reference.mjs': `
      globalThis[Symbol.for((void Function, 'f1.esm'))] = 17;
      export const r = globalThis[Symbol.for('f1.esm')];
      delete globalThis[Symbol.for('f1.esm')];
    `,
  };

  for (const [path, source] of Object.entries(allowedEsm)) {
    it(`ESM compiles and runs ${path}`, async () => {
      const loader = setup({ [path]: source });
      const ns = await loader.import(path, '/entry.mjs');
      expect(ns.r).toBeDefined();
    });
  }

  it('CJS compiles and runs the undici defineProperty shape', () => {
    const loader = setup({
      '/undici-shape.cjs': `
        const D = Symbol.for('undici.globalDispatcher.2');
        Object.defineProperty(globalThis, D, { value: 'dp', configurable: true });
        module.exports = globalThis[D];
      `,
    });
    expect(loader.require('./undici-shape.cjs', '/entry.cjs')).toBe('dp');
  });

  it('CJS compiles and runs the const-alias write shape', () => {
    const loader = setup({
      '/alias-write.cjs': `
        const K = Symbol.for('cjs.stash');
        globalThis[K] = 'cjs-ok';
        module.exports = globalThis[K];
      `,
    });
    expect(loader.require('./alias-write.cjs', '/entry.cjs')).toBe('cjs-ok');
  });

  it('CJS runs defineProperty with a DIRECT Symbol.for key (alias cannot discriminate it)', () => {
    const loader = setup({
      '/direct-define.cjs': `
        Object.defineProperty(globalThis, Symbol.for('cjs.direct'), { value: 'direct', configurable: true });
        module.exports = globalThis[Symbol.for('cjs.direct')];
      `,
    });
    expect(loader.require('./direct-define.cjs', '/entry.cjs')).toBe('direct');
  });

  it('CJS compiles and runs the stash method-call shape (@vitest/utils timers)', () => {
    const loader = setup({
      '/method-call.cjs': `
        const M = Symbol.for('cjs.timers');
        globalThis[M] = { ping() { return 'pong'; } };
        module.exports = globalThis[M].ping();
      `,
    });
    expect(loader.require('./method-call.cjs', '/entry.cjs')).toBe('pong');
  });

  it('CJS allows a genuine Symbol-key write before any tamper (source order)', () => {
    const loader = setup({
      '/write-before-tamper.cjs': `
        const originalFor = Symbol.for;
        const K = Symbol.for('cjs.write.before.tamper');
        globalThis[K] = 'wbt-ok';
        Symbol.for = () => 'tampered-sentinel';
        Symbol.for = originalFor;
        module.exports = globalThis[K];
        delete globalThis[K];
      `,
    });
    expect(loader.require('./write-before-tamper.cjs', '/entry.cjs')).toBe('wbt-ok');
  });

  it('CJS allows a nested-function local-Symbol mutation inside the key (R3 F3)', () => {
    const loader = setup({
      '/key-nested-local.cjs': `
        const K = Symbol.for('cjs.key.nested.local');
        globalThis[((Symbol) => { Symbol.for = () => 'tampered-sentinel'; })({ for: () => 'z' }), K] = 'nested-ok';
        module.exports = globalThis[K];
        delete globalThis[K];
      `,
    });
    expect(loader.require('./key-nested-local.cjs', '/entry.cjs')).toBe('nested-ok');
  });

  it('CJS runs the Reflect.set / Object.assign / Object.defineProperties mutation shapes', () => {
    const loader = setup({
      '/mutations.cjs': `
        const R = Symbol.for('cjs.reflect');
        Reflect.set(globalThis, R, 'rs');
        const A = Symbol.for('cjs.assign');
        Object.assign(globalThis, { [A]: 'as' });
        const P = Symbol.for('cjs.props');
        Object.defineProperties(globalThis, { [P]: { value: 'ps', configurable: true } });
        module.exports = [globalThis[R], globalThis[A], globalThis[P]].join(' ');
      `,
    });
    expect(loader.require('./mutations.cjs', '/entry.cjs')).toBe('rs as ps');
  });

  // R4 F1: the early key walk is a probe — its Function/WebAssembly edits
  // must NOT survive into applyEdits, or the in-order re-walk pushes them
  // again and the rewritten source references `__riftyFunction__riftyFunction`.
  // One carrier per mutation site, producers alternated.
  it('CJS key-interior Function/WebAssembly references rewrite exactly once (R4 F1)', () => {
    const loader = setup({
      '/key-edits.cjs': `
        globalThis[Symbol.for((void Function, 'f1.assign'))] = 17;
        Object.defineProperty(globalThis, Symbol.for((void WebAssembly, 'f1.dp')), { value: 18, configurable: true });
        Reflect.set(globalThis, Symbol.for((void Function, 'f1.rs')), 19);
        globalThis[Symbol.for((void WebAssembly, 'f1.rd'))] = 0;
        Reflect.deleteProperty(globalThis, Symbol.for((void WebAssembly, 'f1.rd')));
        globalThis.__defineGetter__(Symbol.for((void Function, 'f1.g')), () => 20);
        Object.defineProperties(globalThis, { [Symbol.for((void Function, 'f1.dps'))]: { value: 21, configurable: true } });
        Object.assign(globalThis, { [Symbol.for((void WebAssembly, 'f1.as'))]: 22 });
        module.exports = [
          globalThis[Symbol.for('f1.assign')],
          globalThis[Symbol.for('f1.dp')],
          globalThis[Symbol.for('f1.rs')],
          typeof globalThis[Symbol.for('f1.rd')],
          globalThis[Symbol.for('f1.g')],
          globalThis[Symbol.for('f1.dps')],
          globalThis[Symbol.for('f1.as')],
        ].join(' ');
      `,
    });
    expect(loader.require('./key-edits.cjs', '/entry.cjs')).toBe('17 18 19 undefined 20 21 22');
  });

  // R4 F2 (CJS twin of the ESM pin): the early walk's alias marks must not
  // leak into the in-order re-walk (Node: 22 — `g.Function = 1` is a LOCAL
  // write; `g` becomes globalThis only after).
  it('CJS key-interior local write before a global-alias mark replays identically (R4 F2)', () => {
    const loader = setup({
      '/key-alias-replay.cjs': `
        let g = {};
        globalThis[Symbol.for((g.Function = 1, g = globalThis, 'f2.cjs'))] = 22;
        module.exports = globalThis[Symbol.for('f2.cjs')];
      `,
    });
    expect(loader.require('./key-alias-replay.cjs', '/entry.cjs')).toBe(22);
  });

  // R4 C1 (CJS twin): a nested-function OWN Symbol mutation inside the key
  // is not tamper; a FRESH Symbol.for after it stays provable — kills a
  // scope-insensitive early-walk mutant.
  it('CJS fresh Symbol.for after a key-interior nested local mutation stays exempt (R4 C1)', () => {
    const loader = setup({
      '/key-fresh-after-nested-local.cjs': `
        globalThis[((Symbol) => { Symbol.for = () => 'inner'; })({ for: () => 'z' }), Symbol.for('c1.cjs.fresh')] = 14;
        module.exports = globalThis[Symbol.for('c1.cjs.fresh')];
      `,
    });
    expect(loader.require('./key-fresh-after-nested-local.cjs', '/entry.cjs')).toBe(14);
  });
});

describe('the ceiling is unchanged for keys that may be Function', () => {
  const stillLoudEsm: Record<string, string> = {
    '/string-literal.mjs': `globalThis["Function"] = 1; export const r = 1;`,
    '/concat-key.mjs': `globalThis["Fun" + "ction"] = 1; export const r = 1;`,
    '/unknown-identifier.mjs': `
      const K = Math.random() > 2 ? 'Function' : 'other';
      globalThis[K] = 1;
      export const r = 1;
    `,
    '/let-bound-symbol.mjs': `
      let K = Symbol.for('let-bound');
      globalThis[K] = 1;
      export const r = 1;
    `,
    // The fake returns a benign sentinel (not 'Function'): the pin
    // discriminates identically, but a wrongly-silent RED run writes a
    // throwaway key instead of clobbering the shared host Function (R4 C4).
    '/shadowed-symbol.mjs': `
      function f(Symbol) {
        globalThis[Symbol.for('shadowed')] = 1;
      }
      f({ for: () => 'shadowed.sentinel' });
      delete globalThis['shadowed.sentinel'];
      export const r = 1;
    `,
    '/symbol-keyfor.mjs': `
      const K = Symbol.keyFor(Symbol.for('registered'));
      globalThis[K] = 1;
      export const r = 1;
    `,
    // Mutation-only exemption boundary: a Symbol key proves the KEY, never
    // the VALUE — the Reflect.get read taint (constructor-read ceiling) is
    // unchanged, so calling the read result stays loud.
    '/reflect-get-called.mjs': `
      const K = Symbol.for('rg.stays-loud');
      const F = Reflect.get(globalThis, K);
      F('x');
      export const r = 1;
    `,
    // Provenance boundary (Final+GREEN R1 F1): lexical unshadowed ≠ unchanged
    // intrinsic. A module that observably substitutes Symbol/Symbol.for keeps
    // every pattern loud — the "symbol" key may be any string. The fakes
    // return a benign sentinel (not 'Function') and the carriers restore the
    // intrinsic + delete the sentinel, so the RED-state run (guard wrongly
    // silent) leaves the shared in-process harness untouched.
    '/tamper-member-for.mjs': `
      const originalFor = Symbol.for;
      Symbol.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-bare-assign.mjs': `
      const OriginalSymbol = Symbol;
      Symbol = { for: () => 'tampered-sentinel' };
      globalThis[Symbol.for('x')] = 1;
      Symbol = OriginalSymbol;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-global-member.mjs': `
      const OriginalSymbol = globalThis.Symbol;
      globalThis.Symbol = { for: () => 'tampered-sentinel' };
      globalThis[Symbol.for('x')] = 1;
      globalThis.Symbol = OriginalSymbol;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-define-property.mjs': `
      const originalFor = Symbol.for;
      Object.defineProperty(Symbol, 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-global-define-property.mjs': `
      const OriginalSymbol = globalThis.Symbol;
      Object.defineProperty(globalThis, 'Symbol', { value: { for: () => 'tampered-sentinel' } });
      globalThis[Symbol.for('x')] = 1;
      globalThis.Symbol = OriginalSymbol;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R2 F1: the same substitution through the GLOBAL object —
    // member chain, defineProperty on globalThis.Symbol, or a 'Symbol'
    // getter on the global — names the real intrinsic even when a local
    // binding shadows the identifier.
    '/tamper-global-member-for.mjs': `
      const originalFor = Symbol.for;
      globalThis.Symbol.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-define-property-global-symbol.mjs': `
      const originalFor = Symbol.for;
      Object.defineProperty(globalThis.Symbol, 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-global-define-getter.mjs': `
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Symbol');
      globalThis.__defineGetter__('Symbol', () => ({ for: () => 'tampered-sentinel' }));
      globalThis[Symbol.for('x')] = 1;
      Object.defineProperty(globalThis, 'Symbol', descriptor);
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R2 F2: a tamper carrier nested INSIDE the mutation key
    // evaluates before the write/call completes — the sequence unwrap must
    // not discard it. One pin per mutation-site family.
    '/tamper-key-sequence.mjs': `
      const originalFor = Symbol.for;
      globalThis[(Symbol.for = () => 'tampered-sentinel', Symbol.for('x'))] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-reflect-set-key-sequence.mjs': `
      const originalFor = Symbol.for;
      Reflect.set(globalThis, (Symbol.for = () => 'tampered-sentinel', Symbol.for('x')), 1);
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-define-property-key-sequence.mjs': `
      const originalFor = Symbol.for;
      Object.defineProperty(globalThis, (Symbol.for = () => 'tampered-sentinel', Symbol.for('x')), { value: 1, configurable: true });
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-assign-key-sequence.mjs': `
      const originalFor = Symbol.for;
      Object.assign(globalThis, { [(Symbol.for = () => 'tampered-sentinel', Symbol.for('x'))]: 1 });
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R3 C1: the remaining two mutation-site families need
    // their own key-interior pins — defineProperties descriptor map and
    // globalThis.__defineGetter__ name argument.
    '/tamper-define-properties-key-sequence.mjs': `
      const originalFor = Symbol.for;
      Object.defineProperties(globalThis, { [(Symbol.for = () => 'tampered-sentinel', Symbol.for('x'))]: { value: 1, configurable: true } });
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-define-getter-key-sequence.mjs': `
      const originalFor = Symbol.for;
      globalThis.__defineGetter__((Symbol.for = () => 'tampered-sentinel', Symbol.for('x')), () => 1);
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R3 F1: a DESTRUCTURING target nested in the key —
    // AssignmentExpression.left is a pattern, not a plain member/identifier.
    '/tamper-key-destructure-array.mjs': `
      const originalFor = Symbol.for;
      globalThis[([Symbol.for] = [() => 'tampered-sentinel'], Symbol.for('x'))] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-key-destructure-object.mjs': `
      const originalFor = Symbol.for;
      globalThis[(({ for: Symbol.for } = { for: () => 'tampered-sentinel' }), Symbol.for('x'))] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R3 F2: the intrinsic reference itself may be
    // sequence/paren-wrapped — (0, Symbol).for = … substitutes the same
    // intrinsic.
    '/tamper-wrapped-member-for.mjs': `
      const originalFor = Symbol.for;
      (0, Symbol).for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-wrapped-define-property.mjs': `
      const originalFor = Symbol.for;
      Object.defineProperty((0, Symbol), 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R3 F4: prototype injection + own-property delete —
    // setPrototypeOf installs an inherited 'for', the delete then opens it.
    // Final+GREEN R3 self-sweep (pre-R4): a const-bound alias of the
    // INTRINSIC ITSELF (`const S = Symbol`) — the member write through the
    // alias substitutes the real intrinsic. let/var aliases stay untracked
    // (reassignment makes them may-alias — the exhaustive ceiling's).
    '/tamper-alias-member-for.mjs': `
      const originalFor = Symbol.for;
      const S = Symbol;
      S.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-alias-define-property.mjs': `
      const originalFor = Symbol.for;
      const S = Symbol;
      Object.defineProperty(S, 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-chained-alias.mjs': `
      const originalFor = Symbol.for;
      const S = Symbol;
      const S2 = S;
      S2.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    '/tamper-prototype-inject.mjs': `
      const originalFor = Symbol.for;
      const originalProto = Object.getPrototypeOf(Symbol);
      Object.setPrototypeOf(Symbol, { for: () => 'tampered-sentinel' });
      globalThis[(delete Symbol.for, Symbol.for('x'))] = 1;
      Object.setPrototypeOf(Symbol, originalProto);
      Object.defineProperty(Symbol, 'for', { value: originalFor, writable: true, configurable: true });
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R4 C2: setPrototypeOf ALONE must flag — the existing pin
    // pairs it with a key-interior delete, which flags independently and
    // cannot kill a drop-setPrototypeOf-arm mutant. Symbol keeps its own
    // 'for', so the RED-state run writes the real symbol key (harmless).
    '/tamper-set-prototype-of-pure.mjs': `
      const originalProto = Object.getPrototypeOf(Symbol);
      Object.setPrototypeOf(Symbol, { for: () => 'tampered-sentinel' });
      globalThis[Symbol.for('setproto.pure')] = 1;
      Object.setPrototypeOf(Symbol, originalProto);
      delete globalThis[Symbol.for('setproto.pure')];
      export const r = 1;
    `,
    // Final+GREEN R4 F3: the WRAPPED global names the same intrinsic —
    // `(0, globalThis).Symbol.for = …` substitutes Symbol.for observably.
    '/tamper-wrapped-global-symbol.mjs': `
      const originalFor = Symbol.for;
      (0, globalThis).Symbol.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R4 F3/C3: a wrapped define-family callee —
    // `(0, Object).defineProperty` IS Object.defineProperty.
    '/tamper-wrapped-define-callee.mjs': `
      const originalFor = Symbol.for;
      (0, Object).defineProperty(Symbol, 'for', { value: () => 'tampered-sentinel', configurable: true });
      globalThis[Symbol.for('x')] = 1;
      Object.defineProperty(Symbol, 'for', { value: originalFor, writable: true, configurable: true });
      delete globalThis['tampered-sentinel'];
      export const r = 1;
    `,
    // Final+GREEN R4 C5: the proof never accepts ALIAS callees — only the
    // bare unshadowed `Symbol.for(…)`/`Symbol(…)` forms are provable. The
    // RED-state run writes a real symbol key (S IS the intrinsic), so the
    // wrongly-silent guard leaves the host untouched.
    '/alias-callee-stays-loud.mjs': `
      const S = Symbol;
      globalThis[S.for('alias.callee')] = 1;
      delete globalThis[S.for('alias.callee')];
      export const r = 1;
    `,
  };

  for (const [path, source] of Object.entries(stillLoudEsm)) {
    it(`ESM stays loud on ${path}`, async () => {
      // R5b C2: the literal/concat pins write into the shared host Function
      // slot — a wrongly-silent RED run would execute the write. Restore the
      // slot whatever the guard does.
      const slot = Object.getOwnPropertyDescriptor(globalThis, 'Function');
      const loader = setup({ [path]: source });
      try {
        await expect(loader.import(path, '/entry.mjs')).rejects.toMatchObject({
          name: 'NotImplementedError',
          feature: 'module-loader.esm-global-function-assignment',
        });
      } finally {
        if (slot) Object.defineProperty(globalThis, 'Function', slot);
      }
    });
  }

  const stillLoudCjs: Record<string, string> = {
    '/cjs-string-literal.cjs': `globalThis["Function"] = 1; module.exports = 1;`,
    '/cjs-unknown.cjs': `
      const K = Math.random() > 2 ? 'Function' : 'other';
      globalThis[K] = 1;
      module.exports = 1;
    `,
    '/cjs-let-bound.cjs': `
      let K = Symbol.for('cjs.let');
      globalThis[K] = 1;
      module.exports = 1;
    `,
    '/cjs-shadowed.cjs': `
      function f(Symbol) {
        globalThis[Symbol.for('cjs.shadowed')] = 1;
      }
      f({ for: () => 'cjs.shadowed.sentinel' });
      delete globalThis['cjs.shadowed.sentinel'];
      module.exports = 1;
    `,
    // Mutation-only exemption boundary (ESM twin above): the Reflect.get
    // read taint is unchanged for provable-Symbol keys.
    '/cjs-reflect-get-called.cjs': `
      const K = Symbol.for('cjs.rg.stays-loud');
      const F = Reflect.get(globalThis, K);
      F('x');
      module.exports = 1;
    `,
    '/cjs-keyfor.cjs': `
      const K = Symbol.keyFor(Symbol.for('cjs.registered'));
      globalThis[K] = 1;
      module.exports = 1;
    `,
    // Provenance boundary (Final+GREEN R1 F1), ESM twins above: observable
    // Symbol/Symbol.for substitution keeps every pattern loud. Benign
    // sentinel + restore so the RED-state run leaves the harness untouched.
    '/cjs-tamper-member-for.cjs': `
      const originalFor = Symbol.for;
      Symbol.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-bare-assign.cjs': `
      const OriginalSymbol = Symbol;
      Symbol = { for: () => 'tampered-sentinel' };
      globalThis[Symbol.for('x')] = 1;
      Symbol = OriginalSymbol;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-global-member.cjs': `
      const OriginalSymbol = globalThis.Symbol;
      globalThis.Symbol = { for: () => 'tampered-sentinel' };
      globalThis[Symbol.for('x')] = 1;
      globalThis.Symbol = OriginalSymbol;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-define-property.cjs': `
      const originalFor = Symbol.for;
      Object.defineProperty(Symbol, 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-global-define-property.cjs': `
      const OriginalSymbol = globalThis.Symbol;
      Object.defineProperty(globalThis, 'Symbol', { value: { for: () => 'tampered-sentinel' } });
      globalThis[Symbol.for('x')] = 1;
      globalThis.Symbol = OriginalSymbol;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    // Final+GREEN R2 F1/F2, ESM twins above.
    '/cjs-tamper-global-member-for.cjs': `
      const originalFor = Symbol.for;
      globalThis.Symbol.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-define-property-global-symbol.cjs': `
      const originalFor = Symbol.for;
      Object.defineProperty(globalThis.Symbol, 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-global-define-getter.cjs': `
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Symbol');
      globalThis.__defineGetter__('Symbol', () => ({ for: () => 'tampered-sentinel' }));
      globalThis[Symbol.for('x')] = 1;
      Object.defineProperty(globalThis, 'Symbol', descriptor);
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-key-sequence.cjs': `
      const originalFor = Symbol.for;
      globalThis[(Symbol.for = () => 'tampered-sentinel', Symbol.for('x'))] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-reflect-set-key-sequence.cjs': `
      const originalFor = Symbol.for;
      Reflect.set(globalThis, (Symbol.for = () => 'tampered-sentinel', Symbol.for('x')), 1);
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-define-property-key-sequence.cjs': `
      const originalFor = Symbol.for;
      Object.defineProperty(globalThis, (Symbol.for = () => 'tampered-sentinel', Symbol.for('x')), { value: 1, configurable: true });
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-assign-key-sequence.cjs': `
      const originalFor = Symbol.for;
      Object.assign(globalThis, { [(Symbol.for = () => 'tampered-sentinel', Symbol.for('x'))]: 1 });
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    // Final+GREEN R3 C1/F1/F2/F4, ESM twins above.
    '/cjs-tamper-define-properties-key-sequence.cjs': `
      const originalFor = Symbol.for;
      Object.defineProperties(globalThis, { [(Symbol.for = () => 'tampered-sentinel', Symbol.for('x'))]: { value: 1, configurable: true } });
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-define-getter-key-sequence.cjs': `
      const originalFor = Symbol.for;
      globalThis.__defineGetter__((Symbol.for = () => 'tampered-sentinel', Symbol.for('x')), () => 1);
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-key-destructure-array.cjs': `
      const originalFor = Symbol.for;
      globalThis[([Symbol.for] = [() => 'tampered-sentinel'], Symbol.for('x'))] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-key-destructure-object.cjs': `
      const originalFor = Symbol.for;
      globalThis[(({ for: Symbol.for } = { for: () => 'tampered-sentinel' }), Symbol.for('x'))] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-wrapped-member-for.cjs': `
      const originalFor = Symbol.for;
      (0, Symbol).for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-wrapped-define-property.cjs': `
      const originalFor = Symbol.for;
      Object.defineProperty((0, Symbol), 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-alias-member-for.cjs': `
      const originalFor = Symbol.for;
      const S = Symbol;
      S.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-alias-define-property.cjs': `
      const originalFor = Symbol.for;
      const S = Symbol;
      Object.defineProperty(S, 'for', { value: () => 'tampered-sentinel' });
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-chained-alias.cjs': `
      const originalFor = Symbol.for;
      const S = Symbol;
      const S2 = S;
      S2.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-prototype-inject.cjs': `
      const originalFor = Symbol.for;
      const originalProto = Object.getPrototypeOf(Symbol);
      Object.setPrototypeOf(Symbol, { for: () => 'tampered-sentinel' });
      globalThis[(delete Symbol.for, Symbol.for('x'))] = 1;
      Object.setPrototypeOf(Symbol, originalProto);
      Object.defineProperty(Symbol, 'for', { value: originalFor, writable: true, configurable: true });
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    // Final+GREEN R3 F5 (CJS only — ESM modules are strict, `with` never
    // parses): a `with` scope can shadow Symbol dynamically, so inside a
    // with body no Symbol key is provable.
    '/cjs-tamper-with-symbol.cjs': `
      with ({ Symbol: { for: () => 'tampered-sentinel' } }) {
        globalThis[Symbol.for('x')] = 1;
      }
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    // Final+GREEN R4 F4: `with` may shadow the const-marked KEY ALIAS
    // itself — the marker no longer proves the lookup value. The shadow is
    // a benign sentinel (not 'Function'), so the wrongly-silent RED run
    // leaves the host Function untouched (R4 C4).
    '/cjs-with-shadows-key-alias.cjs': `
      const K = Symbol.for('r4.with.alias');
      with ({ K: 'with.sentinel' }) {
        globalThis[K] = 17;
      }
      delete globalThis['with.sentinel'];
      module.exports = 1;
    `,
    // Final+GREEN R5: tamper INSIDE a with body with a non-shadowing
    // with-object hits the REAL intrinsic — detection uses the lexical
    // probe, so post-with keys stay loud (the augmented probe's withDepth
    // disjunct would excuse it).
    '/cjs-tamper-member-in-with.cjs': `
      const originalFor = Symbol.for;
      with ({}) { Symbol.for = () => 'tampered-sentinel'; }
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-define-property-in-with.cjs': `
      const originalFor = Symbol.for;
      with ({}) { Object.defineProperty(Symbol, 'for', { value: () => 'tampered-sentinel', configurable: true }); }
      globalThis[Symbol.for('x')] = 1;
      Object.defineProperty(Symbol, 'for', { value: originalFor, writable: true, configurable: true });
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    // R4 C2/C3/F3 CJS twins of the ESM pins (same rationales).
    '/cjs-tamper-set-prototype-of-pure.cjs': `
      const originalProto = Object.getPrototypeOf(Symbol);
      Object.setPrototypeOf(Symbol, { for: () => 'tampered-sentinel' });
      globalThis[Symbol.for('cjs.setproto.pure')] = 1;
      Object.setPrototypeOf(Symbol, originalProto);
      delete globalThis[Symbol.for('cjs.setproto.pure')];
      module.exports = 1;
    `,
    '/cjs-tamper-wrapped-global-symbol.cjs': `
      const originalFor = Symbol.for;
      (0, globalThis).Symbol.for = () => 'tampered-sentinel';
      globalThis[Symbol.for('x')] = 1;
      Symbol.for = originalFor;
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-tamper-wrapped-define-callee.cjs': `
      const originalFor = Symbol.for;
      (0, Object).defineProperty(Symbol, 'for', { value: () => 'tampered-sentinel', configurable: true });
      globalThis[Symbol.for('x')] = 1;
      Object.defineProperty(Symbol, 'for', { value: originalFor, writable: true, configurable: true });
      delete globalThis['tampered-sentinel'];
      module.exports = 1;
    `,
    '/cjs-alias-callee-stays-loud.cjs': `
      const S = Symbol;
      globalThis[S.for('cjs.alias.callee')] = 1;
      delete globalThis[S.for('cjs.alias.callee')];
      module.exports = 1;
    `,
  };

  for (const [path, source] of Object.entries(stillLoudCjs)) {
    it(`CJS stays loud on ${path}`, () => {
      // R5b C2: restore the shared host Function slot — see the ESM twin.
      const slot = Object.getOwnPropertyDescriptor(globalThis, 'Function');
      const loader = setup({ [path]: source });
      try {
        expect(() => loader.require(`.${path}`, '/entry.cjs')).toThrowError(
          /module-loader\.cjs-global-function-assignment/,
        );
      } finally {
        if (slot) Object.defineProperty(globalThis, 'Function', slot);
      }
    });
  }
});

describe('key-interior evaluation order is source order (R5)', () => {
  // Final+GREEN R5 (reviewer probe): the key interior runs BEFORE the outer
  // write, in source order — a nested Symbol-key write whose fresh key
  // PRECEDES the tamper is legitimate (write-before-tamper, R2 C1), the
  // tamper is flagged for what follows, and the outer alias key (a real
  // Symbol regardless) stays exempt. Node evaluates every site to 2.
  // A probe-pass design that lets the tamper flag leak into the key's own
  // re-walk wrongly rejects the nested write at ALL six sites.
  const keyInterior =
    "(globalThis[Symbol.for('r5.inner')] = 1, Symbol.for = () => 'r5.sentinel', Symbol.for = saved, K)";
  const sites: Record<string, string> = {
    write: `globalThis[${keyInterior}] = 2;`,
    defineProperty: `Object.defineProperty(globalThis, ${keyInterior}, { value: 2, configurable: true });`,
    reflectSet: `Reflect.set(globalThis, ${keyInterior}, 2);`,
    defineProperties: `Object.defineProperties(globalThis, { [${keyInterior}]: { value: 2, configurable: true } });`,
    assign: `Object.assign(globalThis, { [${keyInterior}]: 2 });`,
    defineGetter: `globalThis.__defineGetter__(${keyInterior}, () => 2);`,
  };
  const prelude = `
    const saved = Symbol.for;
    const K = Symbol.for('r5.outer');
    const I = Symbol.for('r5.inner');
  `;
  const cleanup = `
    const r = globalThis[K];
    delete globalThis[K];
    delete globalThis[I];
  `;
  for (const [site, mutation] of Object.entries(sites)) {
    it(`ESM runs key-interior write-then-tamper at the ${site} site`, async () => {
      const loader = setup({
        [`/r5-order-${site}.mjs`]: `${prelude}${mutation}${cleanup} export { r };`,
      });
      const ns = await loader.import(`/r5-order-${site}.mjs`, '/entry.mjs');
      expect(ns.r).toBe(2);
    });
    it(`CJS runs key-interior write-then-tamper at the ${site} site`, () => {
      const loader = setup({
        [`/r5-order-${site}.cjs`]: `${prelude}${mutation}${cleanup} module.exports = r;`,
      });
      expect(loader.require(`./r5-order-${site}.cjs`, '/entry.cjs')).toBe(2);
    });
  }
});

describe('mutation-site evaluation order matches Node (R5b)', () => {
  // Final+GREEN R5b F1: the site's OWN intrinsic substitution lands after
  // its interior evaluates — a nested genuine Symbol-key write inside the
  // target key or the right-hand side runs before the tamper and stays
  // exempt (write-before-tamper, R2 C1). The tamper flag must not be set
  // before the object/key/right-hand-side walk. The discriminating position
  // carries a FRESH Symbol.for key (a const alias is flag-immune and could
  // not discriminate); the const alias K serves the post-tamper cleanup.
  // Node v24.16.0 evaluates every carrier to 1 (oracle-pinned 2026-10-02).
  const orderFaithful: Record<string, string> = {
    'member-assignment': `
      const saved = Symbol.for; const K = Symbol.for('r6.member.assign');
      Symbol[(Reflect.set(globalThis, Symbol.for('r6.member.assign'), 1), 'for')] = () => 'r6.sentinel';
      Symbol.for = saved;
      const r = globalThis[K]; delete globalThis[K];
    `,
    'member-delete': `
      const saved = Symbol.for; const K = Symbol.for('r6.member.delete');
      delete Symbol[(Reflect.set(globalThis, Symbol.for('r6.member.delete'), 1), 'for')];
      Object.defineProperty(Symbol, 'for', { value: saved, writable: true, configurable: true });
      const r = globalThis[K]; delete globalThis[K];
    `,
    // `Symbol.x++` yields NaN and cannot substitute the intrinsic — updates
    // stay untracked (contract), so neither the nested write nor a LATER
    // fresh key may go loud.
    'member-update': `
      const K = Symbol.for('r6.member.update');
      Symbol[(Reflect.set(globalThis, Symbol.for('r6.member.update'), 1), 'r6.count')]++;
      globalThis[Symbol.for('r6.member.update.fresh')] = 1;
      const r = globalThis[K] + globalThis[Symbol.for('r6.member.update.fresh')] - 1;
      delete globalThis[K]; delete globalThis[Symbol.for('r6.member.update.fresh')];
      delete Symbol['r6.count'];
    `,
    'bare-assignment-rhs': `
      const savedSymbol = Symbol; const K = Symbol.for('r6.bare.assign');
      Symbol = (Reflect.set(globalThis, Symbol.for('r6.bare.assign'), 1), { for: savedSymbol.for });
      const r = globalThis[K]; delete globalThis[K]; Symbol = savedSymbol;
    `,
    'member-assignment-rhs': `
      const saved = Symbol.for; const K = Symbol.for('r6.member.rhs');
      Symbol.for = (Reflect.set(globalThis, Symbol.for('r6.member.rhs'), 1), () => 'r6.sentinel');
      Symbol.for = saved;
      const r = globalThis[K]; delete globalThis[K];
    `,
    'call-value-tamper': `
      const saved = Symbol.for; const K = Symbol.for('r6.call.value');
      Reflect.set(globalThis, Symbol.for('r6.call.value'), (Symbol.for = () => 'r6.sentinel', Symbol.for = saved, 1));
      const r = globalThis[K]; delete globalThis[K];
    `,
    'define-property-value-tamper': `
      const saved = Symbol.for; const K = Symbol.for('r6.dp.value');
      Object.defineProperty(globalThis, Symbol.for('r6.dp.value'), { value: (Symbol.for = () => 'r6.sentinel', Symbol.for = saved, 1), configurable: true });
      const r = globalThis[K]; delete globalThis[K];
    `,
    'assign-value-tamper': `
      const saved = Symbol.for; const K = Symbol.for('r6.assign.value');
      Object.assign(globalThis, { [Symbol.for('r6.assign.value')]: (Symbol.for = () => 'r6.sentinel', Symbol.for = saved, 1) });
      const r = globalThis[K]; delete globalThis[K];
    `,
    'define-properties-value-tamper': `
      const saved = Symbol.for; const K = Symbol.for('r6.dps.value');
      Object.defineProperties(globalThis, { [Symbol.for('r6.dps.value')]: { value: (Symbol.for = () => 'r6.sentinel', Symbol.for = saved, 1), configurable: true } });
      const r = globalThis[K]; delete globalThis[K];
    `,
    'define-getter-value-tamper': `
      const saved = Symbol.for; const K = Symbol.for('r6.getter.value');
      globalThis.__defineGetter__(Symbol.for('r6.getter.value'), (Symbol.for = () => 'r6.sentinel', Symbol.for = saved, () => 1));
      const r = globalThis[K]; delete globalThis[K];
    `,
    // Sibling sites, same class: a for-in/of target write lands after the
    // iterated expression; a destructuring write after the right-hand side;
    // a pattern-target write after its default initialiser.
    'for-in-target': `
      const saved = Symbol.for; const K = Symbol.for('r6.forin');
      for (Symbol.for of [(globalThis[Symbol.for('r6.forin')] = 1, () => 'r6.sentinel')]) {}
      Symbol.for = saved;
      const r = globalThis[K]; delete globalThis[K];
    `,
    'destructure-rhs': `
      const saved = Symbol.for; const K = Symbol.for('r6.destructure');
      [Symbol.for] = [(globalThis[Symbol.for('r6.destructure')] = 1, () => 'r6.sentinel')];
      Symbol.for = saved;
      const r = globalThis[K]; delete globalThis[K];
    `,
    'pattern-default': `
      const saved = Symbol.for; const K = Symbol.for('r6.default');
      [Symbol.for = (globalThis[Symbol.for('r6.default')] = 1, () => 'r6.sentinel')] = [];
      Symbol.for = saved;
      const r = globalThis[K]; delete globalThis[K];
    `,
  };
  for (const [name, body] of Object.entries(orderFaithful)) {
    it(`ESM runs write-before-own-tamper at the ${name} site`, async () => {
      const loader = setup({ [`/r6-order-${name}.mjs`]: `${body} export { r };` });
      const ns = await loader.import(`/r6-order-${name}.mjs`, '/entry.mjs');
      expect(ns.r).toBe(1);
    });
    it(`CJS runs write-before-own-tamper at the ${name} site`, () => {
      const loader = setup({ [`/r6-order-${name}.cjs`]: `${body} module.exports = r;` });
      expect(loader.require(`./r6-order-${name}.cjs`, '/entry.cjs')).toBe(1);
    });
  }

  // Final+GREEN R5b F2: the target/callee object reference evaluates FIRST —
  // a later key/argument interior that rebinds the alias must not re-classify
  // the captured reference. A captured LOCAL target stays allowed even when
  // the interior rebinds the alias to the global object (Node: 1).
  const capturedLocalTarget: Record<string, string> = {
    direct: `
      const target = {}; let g = target;
      g[(g = globalThis, 'Function')] = 1;
      const r = target.Function; delete target.Function;
    `,
    'reflect-set': `
      const target = {}; let g = target;
      Reflect.set(g, (g = globalThis, 'Function'), 1);
      const r = target.Function; delete target.Function;
    `,
    assign: `
      const target = {}; let g = target;
      Object.assign(g, { [(g = globalThis, 'Function')]: 1 });
      const r = target.Function; delete target.Function;
    `,
    getter: `
      const target = {}; let g = target;
      g.__defineGetter__((g = globalThis, 'Function'), () => 1);
      const r = target.Function; delete target.Function;
    `,
    'define-properties': `
      const target = {}; let g = target;
      Object.defineProperties(g, { [(g = globalThis, 'Function')]: { value: 1, configurable: true } });
      const r = target.Function; delete target.Function;
    `,
    'define-property': `
      const target = {}; let g = target;
      Object.defineProperty(g, (g = globalThis, 'Function'), { value: 1, configurable: true });
      const r = target.Function; delete target.Function;
    `,
  };
  for (const [name, body] of Object.entries(capturedLocalTarget)) {
    it(`ESM keeps the captured local target at the ${name} site`, async () => {
      const loader = setup({ [`/r6-local-${name}.mjs`]: `${body} export { r };` });
      const ns = await loader.import(`/r6-local-${name}.mjs`, '/entry.mjs');
      expect(ns.r).toBe(1);
    });
    it(`CJS keeps the captured local target at the ${name} site`, () => {
      const loader = setup({ [`/r6-local-${name}.cjs`]: `${body} module.exports = r;` });
      expect(loader.require(`./r6-local-${name}.cjs`, '/entry.cjs')).toBe(1);
    });
  }

  // F2 mirror: a captured GLOBAL target stays loud even when the interior
  // rebinds the alias to a local — the write lands on the real global object
  // (baseline 0c4c1b07 rejected all six; the walk-first redesign flipped the
  // verdicts). The value is a benign literal (a globalThis.Function READ
  // would taint independently and could not discriminate the target
  // classification); the harness finally restores the host slot, so a
  // wrongly-silent RED run leaves the shared process clean (R4 C4, R5b C2).
  const capturedGlobalTarget: Record<string, string> = {
    direct: `
      let g = globalThis;
      g[(g = {}, 'Function')] = 1;
    `,
    'reflect-set': `
      let g = globalThis;
      Reflect.set(g, 'Function', (g = {}, 1));
    `,
    assign: `
      let g = globalThis;
      Object.assign(g, (g = {}, { Function: 1 }));
    `,
    getter: `
      let g = globalThis;
      g.__defineGetter__((g = {}, 'Function'), () => 1);
    `,
    'define-properties': `
      let g = globalThis;
      Object.defineProperties(g, { [(g = {}, 'Function')]: { value: 1, configurable: true } });
    `,
    'define-property': `
      let g = globalThis;
      Object.defineProperty(g, 'Function', (g = {}, { value: 1, writable: true, configurable: true }));
    `,
  };
  for (const [name, body] of Object.entries(capturedGlobalTarget)) {
    it(`ESM stays loud on the captured global target at the ${name} site`, async () => {
      const slot = Object.getOwnPropertyDescriptor(globalThis, 'Function');
      const loader = setup({ [`/r6-global-${name}.mjs`]: `${body} export const r = 1;` });
      try {
        await expect(loader.import(`/r6-global-${name}.mjs`, '/entry.mjs')).rejects.toMatchObject({
          name: 'NotImplementedError',
          feature: 'module-loader.esm-global-function-assignment',
        });
      } finally {
        if (slot) Object.defineProperty(globalThis, 'Function', slot);
      }
    });
    it(`CJS stays loud on the captured global target at the ${name} site`, () => {
      const slot = Object.getOwnPropertyDescriptor(globalThis, 'Function');
      const loader = setup({ [`/r6-global-${name}.cjs`]: `${body} module.exports = 1;` });
      try {
        expect(() => loader.require(`./r6-global-${name}.cjs`, '/entry.cjs')).toThrowError(
          /module-loader\.cjs-global-function-assignment/,
        );
      } finally {
        if (slot) Object.defineProperty(globalThis, 'Function', slot);
      }
    });
  }
});

describe('export-wrapped declarations enter guard bindings', () => {
  // RED today (probed 2026-10-01): predeclareGuardLexicalScope does not
  // unwrap ExportNamedDeclaration, so `export const g = globalThis` never
  // enters `bindings`, alias marking no-ops, and the Function-assignment
  // ceiling is evaded. The predeclare unwrap (forced by the export-wrapped
  // Symbol-alias carrier) closes the hole — pinned here, declared in the
  // contract Decisions.
  it('ESM export-wrapped globalThis alias write throws like its non-export twin', async () => {
    // The write puts the REAL Function back: a wrongly-silent RED run leaves
    // the shared host Function intact (R4 C4) and still fails this pin.
    const loader = setup({
      '/export-global-alias.mjs': `
        export const g = globalThis;
        g.Function = globalThis.Function;
        export const r = 1;
      `,
    });
    await expect(loader.import('/export-global-alias.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.esm-global-function-assignment',
    });
  });
});
