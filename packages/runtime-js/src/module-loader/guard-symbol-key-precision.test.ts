/**
 * Guard precision (symbol-key-global-write-guard-precision): the ESM/CJS
 * Function write guards accept computed keys provably bound to Symbol values
 * (@vitest/utils `globalThis[SAFE_TIMERS_SYMBOL]`, undici
 * `Object.defineProperty(globalThis, Symbol.for(...), …)`) and keep rejecting
 * keys that may be `'Function'`. A Symbol-valued key is never the string
 * 'Function'; a `let`/non-Symbol-bound key keeps the loud ceiling.
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const CLEANUP: symbol[] = [];
afterEach(() => {
  for (const key of CLEANUP.splice(0)) {
    Reflect.deleteProperty(globalThis, key);
  }
});

function esmLoader(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/work/package.json': '{"type":"module"}', ...files });
  return createModuleLoader(vfs, { cwd: '/work' });
}

function cjsLoader(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/work/package.json': '{"type":"commonjs"}', ...files });
  return createModuleLoader(vfs, { cwd: '/work' });
}

describe('ESM guard accepts provably-Symbol computed keys', () => {
  it('const Symbol.for key: globalThis[KEY] = value loads and the write lands', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "const KEY = Symbol.for('test.safe-timers'); globalThis[KEY] = { landed: true }; export const out = globalThis[KEY].landed;\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: boolean };
    expect(ns.out).toBe(true);
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('test.safe-timers')]).toEqual({
      landed: true,
    });
    CLEANUP.push(Symbol.for('test.safe-timers'));
  });

  it('export const Symbol.for key marks too (exported declarator)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "export const KEY = Symbol.for('test.exported'); globalThis[KEY] = { landed: true }; export const out = 'ok';\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('ok');
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('test.exported')]).toEqual({
      landed: true,
    });
    Reflect.deleteProperty(globalThis, Symbol.for('test.exported'));
  });

  it('a mutated Symbol.for disables the exemption (not provable)', async () => {
    const originalFor = Symbol.for;
    const loader = esmLoader({
      '/work/main.mjs':
        "Symbol.for = () => 'Function'; const KEY = Symbol.for('x'); globalThis[KEY] = 1; export const out = 'unreachable';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
    Symbol.for = originalFor;
  });

  it('direct Symbol() key expression loads', async () => {
    const loader = esmLoader({
      '/work/main.mjs': "globalThis[Symbol('direct')] = 1; export const out = 'ok';\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('ok');
    for (const key of Object.getOwnPropertySymbols(globalThis)) {
      const desc = key.toString();
      if (desc.includes('direct')) {
        Reflect.deleteProperty(globalThis, key);
        CLEANUP.push(key);
      }
    }
  });

  it('non-Symbol-bound computed key keeps the loud ceiling (may hold Function)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "let KEY = 'Function'; globalThis[KEY] = function evil() {}; export const out = 'unreachable';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('comments/strings mentioning Symbol.for mutations do NOT poison (AST-based)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "// Symbol.for = () => 'Function'\nconst KEY = Symbol.for('test.comment'); globalThis[KEY] = 1; export const out = 'ok';\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('ok');
    Reflect.deleteProperty(globalThis, Symbol.for('test.comment'));
  });

  it('computed Symbol[for] mutation poisons', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "Symbol['for'] = () => 'Function'; const KEY = Symbol.for('x'); globalThis[KEY] = 1; export const out = 'unreachable';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('a class named Symbol poisons (static for shadows nothing at module scope)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "export default class Symbol { static for() { return 'Function'; } }\nconst KEY = Symbol.for('x'); globalThis[KEY] = 1; export const out = 'unreachable';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('sibling-statement aliases poison (alias survives to later statements)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "const S = Symbol;\nS.for = () => 'Function';\nconst K = Symbol.for('x'); globalThis[K] = 1; export const out = 'u';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('global Symbol passed into a Symbol-named parameter poisons (mutation reaches the builtin)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "function tweak(Symbol) { Symbol.for = () => 'Function'; }\ntweak(Symbol);\nconst K = Symbol.for('x'); globalThis[K] = 1; export const out = 'u';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('alias via ASSIGNMENT poisons: let S; S = Symbol; S.for = …', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "let S; S = Symbol; S.for = () => 'Function'; const K = Symbol.for('x'); globalThis[K] = 1; export const out = 'u';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('a pure identity function with a Symbol param does NOT poison', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "function identity(Symbol) { return Symbol; } const S2 = identity(Symbol); const K = Symbol.for('review.identity'); globalThis[K] = 9; export const out = typeof S2;\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('function');
    Reflect.deleteProperty(globalThis, Symbol.for('review.identity'));
  });

  it('alias-of-alias poisons transitively: const S=Symbol; const T=S; T.for=…', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "const S = Symbol; const T = S; T.for = () => 'Function'; const K = Symbol.for('x'); globalThis[K] = 1; export const out = 'u';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('a BLOCK-scoped const named Symbol does NOT poison the module', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "{ const Symbol = { for: 0 }; Symbol.for = 1; }\nconst K = Symbol.for('review.block'); globalThis[K] = 5; export const out = 'ok';\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('ok');
    Reflect.deleteProperty(globalThis, Symbol.for('review.block'));
  });

  it("literal string writes keep today's behavior: 'Function' rejects, other literals pass", async () => {
    const loud = esmLoader({
      '/work/loud.mjs': 'globalThis.Function = function evil() {};\n',
    });
    await expect(loud.import('./loud.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
    const pass = esmLoader({
      '/work/pass.mjs': "globalThis.someOrdinaryKey = 1; export const out = 'ok';\n",
    });
    const ns = (await pass.import('./pass.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('ok');
    Reflect.deleteProperty(globalThis, 'someOrdinaryKey');
  });
});

describe('CJS guard accepts provably-Symbol computed keys', () => {
  it('undici shape: Object.defineProperty(globalThis, Symbol.for key, …) loads', () => {
    const loader = cjsLoader({
      '/work/main.js':
        "const KEY = Symbol.for('test.global-dispatcher'); Object.defineProperty(globalThis, KEY, { value: 'set', configurable: true }); module.exports = Object.getOwnPropertyDescriptor(globalThis, KEY)?.value;\n",
    });
    expect(loader.require('./main.js', '/work/__entry__.js')).toBe('set');
    CLEANUP.push(Symbol.for('test.global-dispatcher'));
  });

  it('hoisted/later Symbol mutation anywhere poisons the whole module (order-free)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "function write() { const K = Symbol.for('x'); globalThis[K] = 1; }\nSymbol.for = () => 'Function';\nwrite(); export const out = 'unreachable';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('Object.assign(Symbol, …) poisons (unrecognized substitution shape)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "Object.assign(Symbol, { for: () => 'Function' }); const KEY = Symbol.for('x'); globalThis[KEY] = 1; export const out = 'unreachable';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('globalThis.Symbol reassignment poisons', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "globalThis.Symbol = { for: () => 'Function' }; const KEY = Symbol.for('x'); globalThis[KEY] = 1; export const out = 'unreachable';\n",
    });
    await expect(loader.import('./main.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('a NESTED function named Symbol does NOT poison (lexical scope)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "function unrelated() { function Symbol() {} }\nconst KEY = Symbol.for('review.safe.nested'); globalThis[KEY] = 17; export const out = 'ok';\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('ok');
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('review.safe.nested')]).toBe(17);
    Reflect.deleteProperty(globalThis, Symbol.for('review.safe.nested'));
  });

  it('computed spellings poison: Object["defineProperty"](Symbol, …) and globalThis["Symbol"] = …', async () => {
    const a = esmLoader({
      '/work/a.mjs':
        "Object['defineProperty'](Symbol, 'for', { value: () => 'Function' }); const KEY = Symbol.for('x'); globalThis[KEY] = 1; export const out = 'unreachable';\n",
    });
    await expect(a.import('./a.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
    const b = esmLoader({
      '/work/b.mjs':
        "globalThis['Symbol'] = { for: () => 'Function' }; const KEY = Symbol.for('x'); globalThis[KEY] = 1; export const out = 'unreachable';\n",
    });
    await expect(b.import('./b.mjs', '/work/__entry__.ts')).rejects.toThrow(
      'module-loader.esm-global-function-assignment',
    );
  });

  it('a LOCAL parameter/declaration named Symbol does NOT poison (scope-aware)', async () => {
    const loader = esmLoader({
      '/work/main.mjs':
        "function tweak(Symbol) { Symbol.for = () => 'Function'; }\nconst KEY = Symbol.for('review.shadowed'); globalThis[KEY] = 17; export const out = 'ok';\n",
    });
    const ns = (await loader.import('./main.mjs', '/work/__entry__.ts')) as { out: string };
    expect(ns.out).toBe('ok');
    Reflect.deleteProperty(globalThis, Symbol.for('review.shadowed'));
  });

  it('CJS: defineProperty on Symbol itself poisons', () => {
    const loader = cjsLoader({
      '/work/main.js':
        "Object.defineProperty(Symbol, 'for', { value: () => 'Function' }); const KEY = Symbol.for('x'); globalThis[KEY] = 1; module.exports = 'unreachable';",
    });
    expect(() => loader.require('./main.js', '/work/__entry__.js')).toThrow(
      'module-loader.cjs-global-function-assignment',
    );
  });

  it('non-Symbol-bound defineProperty key keeps the loud ceiling', () => {
    const loader = cjsLoader({
      '/work/main.js':
        "let KEY = 'Function'; Object.defineProperty(globalThis, KEY, { value: function evil() {} }); module.exports = 'unreachable';\n",
    });
    expect(() => loader.require('./main.js', '/work/__entry__.js')).toThrow(
      'module-loader.cjs-global-function-assignment',
    );
  });
});
