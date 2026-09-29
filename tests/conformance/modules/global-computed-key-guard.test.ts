import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';

// ADR-0444: a runtime computed key on a global write/define/delete is checked
// when Node would coerce it; only a key that IS 'Function' keeps the ceiling
// (Node mutates the global there — evidence §Oracle O3). Non-'Function' keys
// are Node parity: tools/node-parity-runner/cases/modules/global-computed-key-writes-*.

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

const HostFunction = Function;
const scratchGlobals = ['__riftyGuardBefore__', '__riftyGuardDefine__', '__riftyGuardKey__'];
const g = globalThis as Record<string, unknown>;

afterEach(() => {
  // A wrong implementation may corrupt the host constructor; never leak that.
  if (globalThis.Function !== HostFunction) {
    Object.defineProperty(globalThis, 'Function', {
      value: HostFunction,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  for (const key of scratchGlobals) delete g[key];
});

const writeSites = {
  esm: `
    export function assign(key, value) { globalThis[key] = value; }
    export function compound(key, value) { globalThis[key] += value; }
    export function increment(key) { return globalThis[key]++; }
    export function destructure(key, value) { [globalThis[key]] = [value]; }
    export function forOf(key, values) { for (globalThis[key] of values); }
    export function define(key, value) { Object.defineProperty(globalThis, key, { value, writable: true, configurable: true }); }
    export function reflectSet(key, value) { return Reflect.set(globalThis, key, value); }
    export function reflectDefine(key, value) { return Reflect.defineProperty(globalThis, key, { value, writable: true, configurable: true }); }
    export function reflectDelete(key) { return Reflect.deleteProperty(globalThis, key); }
    export function defineGetter(key, value) { globalThis.__defineGetter__(key, () => value); }
    export function remove(key) { return delete globalThis[key]; }
  `,
  cjs: `
    exports.assign = function (key, value) { global[key] = value; };
    exports.compound = function (key, value) { global[key] += value; };
    exports.increment = function (key) { return global[key]++; };
    exports.destructure = function (key, value) { [globalThis[key]] = [value]; };
    exports.forOf = function (key, values) { for (global[key] of values); };
    exports.define = function (key, value) { Object.defineProperty(globalThis, key, { value, writable: true, configurable: true }); };
    exports.reflectSet = function (key, value) { return Reflect.set(globalThis, key, value); };
    exports.reflectDefine = function (key, value) { return Reflect.defineProperty(global, key, { value, writable: true, configurable: true }); };
    exports.reflectDelete = function (key) { return Reflect.deleteProperty(globalThis, key); };
    exports.defineGetter = function (key, value) { global.__defineGetter__(key, () => value); };
    exports.remove = function (key) { return delete global[key]; };
  `,
};

type WriteSite =
  | 'assign'
  | 'compound'
  | 'increment'
  | 'destructure'
  | 'forOf'
  | 'define'
  | 'reflectSet'
  | 'reflectDefine'
  | 'reflectDelete'
  | 'defineGetter'
  | 'remove';
type WriteSites = Record<WriteSite, (key: unknown, value?: unknown) => unknown>;

function expectRuntimeKeyCeiling(sites: WriteSites, feature: string): void {
  // Non-'Function' runtime keys write the global as in Node.
  const key = '__riftyGuardKey__';
  sites.assign(key, 1);
  sites.compound(key, 1);
  expect(sites.increment(key)).toBe(2);
  expect(g[key]).toBe(3);
  expect(sites.reflectSet(key, 4)).toBe(true);
  sites.destructure(key, 5);
  expect(g[key]).toBe(5);
  sites.forOf(key, [6]);
  expect(g[key]).toBe(6);
  sites.define(key, 7);
  expect(sites.reflectDefine(key, 8)).toBe(true);
  expect(g[key]).toBe(8);
  expect(sites.reflectDelete(key)).toBe(true);
  sites.defineGetter(key, 9);
  expect(g[key]).toBe(9);
  expect(sites.remove(key)).toBe(true);
  expect(Object.hasOwn(globalThis, key)).toBe(false);

  // A runtime key that IS 'Function' (string or coercing object) keeps the ceiling.
  const replacement = function ReplacedFunction() {};
  for (const functionKey of ['Function', { toString: () => 'Function' }]) {
    for (const call of [
      () => sites.assign(functionKey, replacement),
      () => sites.compound(functionKey, 'x'),
      () => sites.increment(functionKey),
      () => sites.destructure(functionKey, replacement),
      () => sites.forOf(functionKey, [replacement]),
      () => sites.define(functionKey, replacement),
      () => sites.reflectSet(functionKey, replacement),
      () => sites.reflectDefine(functionKey, replacement),
      () => sites.reflectDelete(functionKey),
      () => sites.defineGetter(functionKey, replacement),
      () => sites.remove(functionKey),
    ]) {
      expect(call).toThrow(expect.objectContaining({ name: 'NotImplementedError', feature }));
      expect(globalThis.Function).toBe(HostFunction);
    }
  }
}

describe('ESM Function guard — runtime computed global keys (ADR-0444)', () => {
  it('loads a module whose global writes take runtime keys; only a runtime Function key throws', async () => {
    const loader = setup({ '/keys.mjs': writeSites.esm });
    const ns = (await loader.import('/keys.mjs', '/entry.mjs')) as unknown as WriteSites;
    expectRuntimeKeyCeiling(ns, 'module-loader.esm-global-function-assignment');
  });

  it('a top-level runtime Function key rejects the import at the write, after earlier statements ran', async () => {
    const loader = setup({
      '/defines.mjs': `
        globalThis.__riftyGuardBefore__ = 'ran';
        const defines = { __riftyGuardDefine__: 1, Function: function DefinedFunction() {} };
        for (const key in defines) globalThis[key] = defines[key];
        export const done = true;
      `,
    });
    await expect(loader.import('/defines.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.esm-global-function-assignment',
    });
    expect(g.__riftyGuardBefore__).toBe('ran');
    expect(g.__riftyGuardDefine__).toBe(1);
    expect(globalThis.Function).toBe(HostFunction);
  });

  it('keeps the load-time ceiling for runtime-key reads used as a constructor', async () => {
    const cases: Record<string, string> = {
      '/reflect-get-param.mjs': `
        globalThis.__riftyGuardBefore__ = 'ran';
        export function make(key) { const F = Reflect.get(globalThis, key); return F('return 1'); }
      `,
      '/computed-read-param.mjs': `
        globalThis.__riftyGuardBefore__ = 'ran';
        export function make(key) { return new globalThis[key]('return 1'); }
      `,
    };
    for (const [path, source] of Object.entries(cases)) {
      const loader = setup({ [path]: source });
      await expect(loader.import(path, '/entry.mjs')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'module-loader.esm-global-function-assignment',
      });
      expect(g.__riftyGuardBefore__).toBeUndefined();
    }
  });
});

describe('CJS Function guard — runtime computed global keys (ADR-0444)', () => {
  it('loads a module whose global writes take runtime keys; only a runtime Function key throws', () => {
    const loader = setup({ '/keys.js': writeSites.cjs });
    const sites = loader.require('./keys.js', '/entry.js') as WriteSites;
    expectRuntimeKeyCeiling(sites, 'module-loader.cjs-global-function-assignment');
  });

  it('a top-level runtime Function key throws at the write, after earlier statements ran', () => {
    const loader = setup({
      '/defines.js': `
        global.__riftyGuardBefore__ = 'ran';
        const defines = { __riftyGuardDefine__: 1, Function: function DefinedFunction() {} };
        for (const key in defines) global[key] = defines[key];
        module.exports = true;
      `,
    });
    expect(() => loader.require('./defines.js', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.cjs-global-function-assignment',
      }),
    );
    expect(g.__riftyGuardBefore__).toBe('ran');
    expect(g.__riftyGuardDefine__).toBe(1);
    expect(globalThis.Function).toBe(HostFunction);
  });

  it('keeps the load-time ceiling for runtime-key reads used as a constructor', () => {
    const loader = setup({
      '/reflect-get-param.js': `
        global.__riftyGuardBefore__ = 'ran';
        exports.make = function (key) { const F = Reflect.get(globalThis, key); return F('return 1'); };
      `,
    });
    expect(() => loader.require('./reflect-get-param.js', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.cjs-global-function-assignment',
      }),
    );
    expect(g.__riftyGuardBefore__).toBeUndefined();
  });
});
