import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';

// ADR-0444 sites beyond global-computed-key-guard.test.ts: a runtime 'Function'
// key keeps the ceiling on every wrapped write site; `delete` operands and
// folded keys keep their load-time ceiling before any statement runs. The same
// sites with non-'Function' keys are Node parity:
// tools/node-parity-runner/cases/modules/global-computed-key-sites-*.

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

const HostFunction = Function;
const g = globalThis as Record<string, unknown>;
const esmFeature = 'module-loader.esm-global-function-assignment';
const cjsFeature = 'module-loader.cjs-global-function-assignment';

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
  Reflect.deleteProperty(g, '__riftyGuardBefore__');
});

const siteBodies = {
  nullish: '(key, value) => { globalThis[key] ??= value; }',
  or: '(key, value) => { G[key] ||= value; }',
  and: '(key, value) => { globalThis[key] &&= value; }',
  preIncrement: '(key) => ++G[key]',
  decrement: '(key) => globalThis[key]--',
  forIn: '(key) => { for (G[key] in { a: 1 }); }',
  objectPattern: '(key, value) => { ({ a: globalThis[key] } = { a: value }); }',
  defaultPattern: '(key, value) => { [G[key] = value] = []; }',
  viaAlias: '(key, value) => { alias[key] = value; }',
  sequenceKey: '(key, value) => { globalThis[(0, key)] = value; }',
  nestedOuter: '(key, value) => { G[G.__riftyGuardBefore__ = key] = value; }',
  nestedInner: '(key, value) => { globalThis[globalThis[key] = "__riftyGuardBefore__"] = value; }',
  defineSetter: '(key, value) => { G.__defineSetter__(key, value); }',
  optionalDelete: '(key) => delete globalThis?.[key]',
} as const;
type Site = keyof typeof siteBodies;

function sitesModule(format: 'esm' | 'cjs'): string {
  const global = format === 'esm' ? 'globalThis' : 'global';
  const lines = Object.entries(siteBodies).map(([name, body]) => {
    const source = body.replaceAll('G[', `${global}[`).replaceAll('G.', `${global}.`);
    return format === 'esm' ? `export const ${name} = ${source};` : `exports.${name} = ${source};`;
  });
  return [`const alias = ${global};`, ...lines].join('\n');
}

function expectEverySiteCeiling(
  sites: Record<Site, (key: unknown, value?: unknown) => unknown>,
  feature: string,
): void {
  const replacement = function ReplacedFunction() {};
  for (const functionKey of ['Function', { toString: () => 'Function' }]) {
    for (const site of Object.keys(siteBodies) as Site[]) {
      expect(() => sites[site](functionKey, replacement), site).toThrow(
        expect.objectContaining({ name: 'NotImplementedError', feature }),
      );
      expect(globalThis.Function, site).toBe(HostFunction);
    }
  }
}

describe('ESM Function guard — every wrapped global-write site (ADR-0444)', () => {
  it('a runtime Function key throws the ceiling at each site; the module loads', async () => {
    const loader = setup({ '/sites.mjs': sitesModule('esm') });
    const sites = (await loader.import('/sites.mjs', '/entry.mjs')) as unknown as Record<
      Site,
      (key: unknown, value?: unknown) => unknown
    >;
    expectEverySiteCeiling(sites, esmFeature);
  });

  it('delete operands and folded keys keep the load-time ceiling before any statement runs', async () => {
    const writes = [
      'delete globalThis?.Function;',
      "delete Object.defineProperty(globalThis, 'Function', { value: 1, configurable: true });",
      'delete (globalThis.Function = 1);',
      "globalThis['Fun' + 'ction'] = 1;",
      'Reflect.set(globalThis, `Function`, 1);',
    ];
    for (const [index, write] of writes.entries()) {
      const path = `/folded-${index}.mjs`;
      const loader = setup({
        [path]: `globalThis.__riftyGuardBefore__ = 'ran';\n${write}\nexport {};`,
      });
      await expect(loader.import(path, '/entry.mjs'), write).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: esmFeature,
      });
      expect(g.__riftyGuardBefore__, write).toBeUndefined();
      expect(globalThis.Function, write).toBe(HostFunction);
    }
  });
});

describe('CJS Function guard — every wrapped global-write site (ADR-0444)', () => {
  it('a runtime Function key throws the ceiling at each site; the module loads', () => {
    const loader = setup({ '/sites.js': sitesModule('cjs') });
    const sites = loader.require('./sites.js', '/entry.js') as Record<
      Site,
      (key: unknown, value?: unknown) => unknown
    >;
    expectEverySiteCeiling(sites, cjsFeature);
  });

  it('delete operands and folded keys keep the load-time ceiling before any statement runs', () => {
    const writes = [
      'delete global?.Function;',
      "delete Object.defineProperty(global, 'Function', { value: 1, configurable: true });",
      'delete (global.Function = 1);',
      "global['Fun' + 'ction'] = 1;",
      'Reflect.set(globalThis, `Function`, 1);',
    ];
    for (const [index, write] of writes.entries()) {
      const path = `/folded-${index}.js`;
      const loader = setup({ [path]: `global.__riftyGuardBefore__ = 'ran';\n${write}` });
      expect(() => loader.require(`.${path}`, '/entry.js'), write).toThrow(
        expect.objectContaining({ name: 'NotImplementedError', feature: cjsFeature }),
      );
      expect(g.__riftyGuardBefore__, write).toBeUndefined();
      expect(globalThis.Function, write).toBe(HostFunction);
    }
  });
});
