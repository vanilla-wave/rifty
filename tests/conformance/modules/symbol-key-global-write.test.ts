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
    '/shadowed-symbol.mjs': `
      function f(Symbol) {
        globalThis[Symbol.for('shadowed')] = 1;
      }
      f({ for: () => 'Function' });
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
  };

  for (const [path, source] of Object.entries(stillLoudEsm)) {
    it(`ESM stays loud on ${path}`, async () => {
      const loader = setup({ [path]: source });
      await expect(loader.import(path, '/entry.mjs')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'module-loader.esm-global-function-assignment',
      });
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
      f({ for: () => 'Function' });
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
  };

  for (const [path, source] of Object.entries(stillLoudCjs)) {
    it(`CJS stays loud on ${path}`, () => {
      const loader = setup({ [path]: source });
      expect(() => loader.require(`.${path}`, '/entry.cjs')).toThrowError(
        /module-loader\.cjs-global-function-assignment/,
      );
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
    const loader = setup({
      '/export-global-alias.mjs': `
        export const g = globalThis;
        g.Function = function F() {};
        export const r = 1;
      `,
    });
    await expect(loader.import('/export-global-alias.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.esm-global-function-assignment',
    });
  });
});
