import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe.each(['cjs', 'esm'] as const)('%s dynamic global key safety', (kind) => {
  it.each([
    ['assignment', 'globalThis[key] = 17'],
    ['destructuring assignment', '({ value: globalThis[key] } = { value: 17 })'],
    ['compound assignment', 'globalThis[key] += 1'],
    ['update', '++globalThis[key]'],
    ['delete', 'delete globalThis[key]'],
    ['defineProperty', 'Object.defineProperty(globalThis, key, { value: 17, configurable: true })'],
    [
      'defineProperties',
      'Object.defineProperties(globalThis, { [key]: { value: 17, configurable: true } })',
    ],
    ['assign', 'Object.assign(globalThis, { [key]: 17 })'],
    [
      'Reflect.defineProperty',
      'Reflect.defineProperty(globalThis, key, { value: 17, configurable: true })',
    ],
    ['Reflect.set', 'Reflect.set(globalThis, key, 17)'],
    ['Reflect.deleteProperty', 'Reflect.deleteProperty(globalThis, key)'],
    ['getter', 'globalThis.__defineGetter__(key, () => 17)'],
    ['setter', 'globalThis.__defineSetter__(key, () => {})'],
  ])('rejects a forged Function key through %s', async (_label, mutation) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
    if (!descriptor) throw new Error('host Function descriptor missing');
    const vfs = new MemoryFsSync();
    const filename = kind === 'esm' ? '/main.mjs' : '/main.cjs';
    vfs.loadFixture({ [filename]: `const key = 'Function'; ${mutation};` });
    const loader = createModuleLoader(vfs);
    try {
      const run = async (): Promise<void> => {
        if (kind === 'esm') await loader.import(filename);
        else loader.require(filename);
      };
      await expect(run()).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: `module-loader.${kind}-global-function-assignment`,
      });
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
    } finally {
      Object.defineProperty(globalThis, 'Function', descriptor);
    }
  });
});
