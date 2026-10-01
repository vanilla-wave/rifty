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
