import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import * as api from './index.ts';
import { createResolver } from './resolver.ts';

describe('explicit tsconfig compiler preload (ADR-0382)', () => {
  it('rejects unprepared opt-in at the sync factory', () => {
    const options = { cwd: '/work', autoDiscoverTsconfigPaths: true };
    expect(() => api.createModuleLoader(new MemoryFsSync(), options)).toThrow(
      /preloadTsconfigPaths/u,
    );
    try {
      api.createModuleLoader(new MemoryFsSync(), options);
    } catch (error) {
      expect(error).toMatchObject({ code: 'TSCONFIG_NOT_READY' });
    }
  });

  it('keeps explicit-map priority without compiler preparation', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/work/value.js': 'module.exports = 42;' });
    const options = { paths: { value: '/work/value.js' }, autoDiscoverTsconfigPaths: true };
    expect(
      createResolver(vfs, options).resolve('value', { fromFile: '/work/main.js', esm: false }).id,
    ).toBe('/work/value.js');
  });

  it('loads once through the public async preloader, then preserves sync discovery', async () => {
    const preload = Reflect.get(api, 'preloadTsconfigPaths') as () => Promise<void>;
    expect(preload).toBeTypeOf('function');
    await Promise.all([preload(), preload()]);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/tsconfig.json': '{ // JSONC\n "compilerOptions": { "baseUrl": "src" } }',
      '/work/src/value.js': 'module.exports = 42;',
    });
    const options = { cwd: '/work', autoDiscoverTsconfigPaths: true };
    expect(api.createModuleLoader(vfs, options).require('value', '/work/main.js')).toBe(42);
  });
});
