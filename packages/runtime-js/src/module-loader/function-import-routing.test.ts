import { describe, expect, it, vi } from 'vitest';
import { createFunctionImportRouting } from './function-import-routing.ts';

describe('Function constructor import routing', () => {
  it('does not classify a Tapable-shaped computed hook call as a derived constructor', () => {
    const dynamicImport = vi.fn(async () => ({ value: 'must-not-load' }));
    const RoutedFunction = createFunctionImportRouting(
      dynamicImport,
      '/tapable/HookCodeFactory.js',
    ).Function;
    const hook = new RoutedFunction(
      'context, entry',
      `"use strict";
        var _x=this._x;
        var _fn0=_x[0];
        var _result0=_fn0(context, entry);
        return _result0;`,
    );
    const compiledHook = vi.fn((context: string, entry: string) => `${context}:${entry}`);

    expect(Reflect.apply(hook, { _x: [compiledHook] }, ['ctx', 'main'])).toBe('ctx:main');
    expect(compiledHook).toHaveBeenCalledWith('ctx', 'main');
    expect(dynamicImport).not.toHaveBeenCalled();
  });

  it('keeps a derived constructor with a static import-bearing parameter behind its ceiling', () => {
    const dynamicImport = vi.fn(async () => ({ value: 'must-not-load' }));
    const RoutedFunction = createFunctionImportRouting(dynamicImport, '/entry.cjs').Function;

    expect(
      () =>
        new RoutedFunction(`
          const DerivedFunction = (() => {}).constructor;
          return DerivedFunction('loaded = import("./dep.mjs")', 'return loaded');
        `),
    ).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
    expect(dynamicImport).not.toHaveBeenCalled();
  });

  it('routes a direct eval literal import through a collision-free lexical helper', async () => {
    const dynamicImport = vi.fn(async (specifier: unknown) => ({
      specifier,
      value: 'routed-eval-import',
    }));
    const RoutedFunction = createFunctionImportRouting(dynamicImport, '/entry.cjs').Function;
    const load = new RoutedFunction(
      'specifier',
      `
        const __riftyDynamicImport = 'guest-binding';
        return eval('(specifier) => import(specifier)')(specifier).then((namespace) => ({
          binding: __riftyDynamicImport,
          value: namespace.value,
        }));
      `,
    );

    await expect(load('./dep.mjs')).resolves.toEqual({
      binding: 'guest-binding',
      value: 'routed-eval-import',
    });
    expect(dynamicImport).toHaveBeenCalledOnce();
    expect(dynamicImport).toHaveBeenCalledWith('./dep.mjs');
  });

  it.each([
    ['indirect', ['specifier', 'return (0, eval)("import(specifier)")']],
    ['global', ['specifier', 'return globalThis.eval("import(specifier)")']],
    ['aliased', ['specifier', 'const evaluate = eval; return evaluate("import(specifier)")']],
    ['with scope', ['specifier', 'with ({}) { return eval("import(specifier)"); }']],
    ['nested eval', ['specifier', 'return eval("eval(\\"import(specifier)\\")")']],
    ['nested function', ['specifier', 'return (() => eval("import(specifier)"))()']],
    ['shadowed', ['eval', 'return eval("import(\\"./dep.mjs\\")")']],
  ])('keeps the %s eval-import path behind a directed ceiling', (_name, args) => {
    const dynamicImport = vi.fn(async () => ({ value: 'must-not-load' }));
    const RoutedFunction = createFunctionImportRouting(dynamicImport, '/entry.cjs').Function;

    expect(() => Reflect.construct(RoutedFunction, args)).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
    expect(dynamicImport).not.toHaveBeenCalled();
  });
});
