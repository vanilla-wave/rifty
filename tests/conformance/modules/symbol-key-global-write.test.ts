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
