import nativeModule from 'node:module';
import { expect, it } from 'vitest';
import { loadBuiltin } from './index.ts';

it('exposes a dense frozen builtinModules array shared with Module, like Node', () => {
  const module = loadBuiltin('node:module') as {
    builtinModules: readonly string[];
    Module: { builtinModules: readonly string[] };
  };
  expect(Object.isFrozen(nativeModule.builtinModules)).toBe(true);
  expect(Object.keys(nativeModule.builtinModules)).toHaveLength(nativeModule.builtinModules.length);
  expect(Object.keys(module.builtinModules)).toHaveLength(module.builtinModules.length);
  expect(Object.isFrozen(module.builtinModules)).toBe(true);
  expect(module.Module.builtinModules).toBe(module.builtinModules);
});
