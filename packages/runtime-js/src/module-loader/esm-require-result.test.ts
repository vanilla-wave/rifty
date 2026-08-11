import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('require(ESM) result selection', () => {
  it('returns a sorted synthetic __esModule facade with live namespace getters', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/facade.mjs': `
        export const z = 'last';
        export let a = 1;
        export const bump = () => { a += 1; };
        export default 'default';
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const required = loader.require('./facade.mjs', '/work/entry.cjs') as Record<string, unknown>;
    const imported = await loader.import('./facade.mjs', '/work/entry.cjs');
    (required.bump as () => void)();

    expect(Object.keys(required)).toEqual(['__esModule', 'a', 'bump', 'default', 'z']);
    expect(required).not.toBe(imported);
    expect(required.a).toBe(2);
    expect(imported.a).toBe(2);
  });

  it('returns an own module.exports binding even when its value is undefined', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/override.mjs': `
        const value = undefined;
        export { value as 'module.exports' };
        export const visibleOnlyToImport = true;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./override.mjs', '/work/entry.cjs')).toBeUndefined();
    const imported = await loader.import('./override.mjs', '/work/entry.cjs');
    expect(Object.hasOwn(imported, 'module.exports')).toBe(true);
    expect(imported.visibleOnlyToImport).toBe(true);
  });
});
