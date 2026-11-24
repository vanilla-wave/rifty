import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';

// Unit runtime-js/computed-global-read-callee. A computed global read called or
// constructed loads (Node parity: tools/node-parity-runner/cases/modules/
// global-computed-read-callee-*). A key that is 'Function' at runtime throws the
// format's named ceiling at that read (ADR-0444 key check): the module never gets
// the host constructor, which would bypass ADR-0171's import() routing. Other
// forms keep the load-time ceiling.

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

const HostFunction = Function;
const g = globalThis as Record<string, unknown>;

afterEach(() => {
  if (globalThis.Function !== HostFunction) {
    Object.defineProperty(globalThis, 'Function', {
      value: HostFunction,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  Reflect.deleteProperty(g, '__riftyGuardBefore__');
});

type Site = (key: unknown, arg: unknown) => unknown;
interface Sites {
  construct: Site;
  call: Site;
  optionalCall: Site;
  callMethod: Site;
  applyMethod: Site;
  bindMethod: Site;
}

function expectRuntimeCeiling(sites: Sites, feature: string): void {
  expect(sites.construct('Uint8Array', 3)).toHaveLength(3);
  expect(sites.call('String', 1)).toBe('1');
  for (const site of Object.values(sites)) {
    for (const key of ['Function', { toString: () => 'Function' }]) {
      expect(() => site(key, 'return 1')).toThrow(
        expect.objectContaining({ name: 'NotImplementedError', feature }),
      );
    }
  }
  expect(globalThis.Function).toBe(HostFunction);
}

describe('computed global read used as a callee/constructor (unit computed-global-read-callee)', () => {
  it('ESM loads; only a runtime Function key throws, at the read', async () => {
    const loader = setup({
      '/sites.mjs': `
        globalThis.__riftyGuardBefore__ = 'ran';
        export function construct(key, arg) { return new globalThis[key](arg); }
        export function call(key, arg) { return global[key](arg); }
        export function optionalCall(key, arg) { return globalThis[key]?.(arg); }
        export function callMethod(key, arg) { return globalThis[key].call(null, arg); }
        export function applyMethod(key, arg) { const g = globalThis; return g[key].apply(null, [arg]); }
        export function bindMethod(key, arg) { return global[key].bind(null, arg)(); }
      `,
    });
    const sites = (await loader.import('/sites.mjs', '/entry.mjs')) as unknown as Sites;
    expect(g.__riftyGuardBefore__).toBe('ran');
    expectRuntimeCeiling(sites, 'module-loader.esm-global-function-assignment');
  });

  it('CJS loads; only a runtime Function key throws, at the read', () => {
    const loader = setup({
      '/sites.js': `
        global.__riftyGuardBefore__ = 'ran';
        exports.construct = function (key, arg) { return new global[key](arg); };
        exports.call = function (key, arg) { return globalThis[key](arg); };
        exports.optionalCall = function (key, arg) { return global[key]?.(arg); };
        exports.callMethod = function (key, arg) { return global[key].call(null, arg); };
        exports.applyMethod = function (key, arg) { const g = global; return g[key].apply(null, [arg]); };
        exports.bindMethod = function (key, arg) { return globalThis[key].bind(null, arg)(); };
      `,
    });
    const sites = loader.require('./sites.js', '/entry.js') as Sites;
    expect(g.__riftyGuardBefore__).toBe('ran');
    expectRuntimeCeiling(sites, 'module-loader.cjs-global-function-assignment');
  });

  it('a top-level runtime Function read throws at that statement, after earlier ones ran', async () => {
    const esm = setup({
      '/top.mjs': `globalThis.__riftyGuardBefore__ = 'ran';\nconst k = ['Function'];\nnew globalThis[k[0]]('return 1');`,
    });
    await expect(esm.import('/top.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.esm-global-function-assignment',
    });
    expect(g.__riftyGuardBefore__).toBe('ran');
    Reflect.deleteProperty(g, '__riftyGuardBefore__');
    const cjs = setup({
      '/top.js': `global.__riftyGuardBefore__ = 'ran';\nvar k = ['Function'];\nnew global[k[0]]('return 1');`,
    });
    expect(() => cjs.require('./top.js', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.cjs-global-function-assignment',
      }),
    );
    expect(g.__riftyGuardBefore__).toBe('ran');
    expect(globalThis.Function).toBe(HostFunction);
  });

  // Out of scope (unit §Out of scope): each still rejects before any statement runs.
  const ceilings = {
    'static read': 'new globalThis.Function("return 1")',
    'folded read': 'new globalThis["Fun" + "ction"]("return 1")',
    'Reflect.get called': 'Reflect.get(globalThis, key)("return 1")',
    'alias of the read': 'const C = globalThis[key]; new C("return 1")',
    'destructured read': 'const { [key]: C } = globalThis; new C("return 1")',
    'optional member': 'globalThis?.[key]("return 1")',
  };

  for (const [name, body] of Object.entries(ceilings)) {
    it(`ESM keeps the load-time ceiling: ${name}`, async () => {
      const loader = setup({
        '/c.mjs': `globalThis.__riftyGuardBefore__ = 'ran';\nexport function f(key) { ${body}; }`,
      });
      await expect(loader.import('/c.mjs', '/entry.mjs')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'module-loader.esm-global-function-assignment',
      });
      expect(g.__riftyGuardBefore__).toBeUndefined();
    });

    it(`CJS keeps the load-time ceiling: ${name}`, () => {
      const loader = setup({
        '/c.js': `global.__riftyGuardBefore__ = 'ran';\nexports.f = function (key) { ${body}; };`,
      });
      expect(() => loader.require('./c.js', '/entry.js')).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.cjs-global-function-assignment',
        }),
      );
      expect(g.__riftyGuardBefore__).toBeUndefined();
    });
  }

  // Review S1: `with` or a non-literal direct eval can shadow the key-check helper, so a
  // module with both and a called computed read keeps a load-time ceiling (dynamic scope).
  const SHADOW = "'var __rifty' + 'GlobalKey = (x) => x'";
  const dynamicScope = {
    cjs: {
      with: 'with ({}) { return new global[key]("return 1"); }',
      'non-literal direct eval': `eval(${SHADOW}); return new global[key]("return 1");`,
    },
    esm: { 'non-literal direct eval': `eval(${SHADOW}); return new globalThis[key]("return 1");` },
  };

  for (const [name, body] of Object.entries(dynamicScope.cjs)) {
    it(`CJS: a called computed read beside ${name} keeps a load-time ceiling`, () => {
      const loader = setup({
        '/d.js': `global.__riftyGuardBefore__ = 'ran';\nexports.f = function (key) { ${body} };`,
      });
      expect(() => loader.require('./d.js', '/entry.js')).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.cjs-dynamic-function-scope',
        }),
      );
      expect(g.__riftyGuardBefore__).toBeUndefined();
    });
  }

  for (const [name, body] of Object.entries(dynamicScope.esm)) {
    it(`ESM: a called computed read beside ${name} keeps a load-time ceiling`, async () => {
      const loader = setup({
        '/d.mjs': `globalThis.__riftyGuardBefore__ = 'ran';\nexport function f(key) { ${body} }`,
      });
      await expect(loader.import('/d.mjs', '/entry.mjs')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'module-loader.esm-dynamic-function-scope',
      });
      expect(g.__riftyGuardBefore__).toBeUndefined();
    });
  }

  // A literal direct eval cannot name the helper (its name avoids the source text); an
  // indirect eval runs in the global scope. Both keep the read admitted.
  it('a literal direct eval or an indirect eval beside a called computed read loads', async () => {
    const body = 'eval("1"); (0, eval)("var __riftyGlobalKey = 1"); return new globalThis[key](1);';
    const cjs = setup({ '/e.js': `exports.f = function (key) { ${body} };` });
    const esm = setup({ '/e.mjs': `export function f(key) { ${body} }` });
    const sites = [
      cjs.require('./e.js', '/entry.js') as { f(key: string): unknown },
      (await esm.import('/e.mjs', '/entry.mjs')) as unknown as { f(key: string): unknown },
    ];
    for (const site of sites) {
      expect(site.f('Uint8Array')).toHaveLength(1);
      expect(() => site.f('Function')).toThrow(
        expect.objectContaining({ name: 'NotImplementedError' }),
      );
    }
    Reflect.deleteProperty(g, '__riftyGlobalKey');
  });
});
