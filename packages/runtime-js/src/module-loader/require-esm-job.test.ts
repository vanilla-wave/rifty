import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';

describe('require(ESM) job retry boundary', () => {
  it('retries a resolution miss after the missing entry appears', () => {
    const vfs = new MemoryFsSync();
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(() => loader.require('./resolution-retry.mjs', '/work/entry.cjs')).toThrow();
    vfs.loadFixture({ '/work/resolution-retry.mjs': 'export const value = 11;' });

    expect(loader.require('./resolution-retry.mjs', '/work/entry.cjs')).toMatchObject({
      value: 11,
    });
  });

  it('retries a parse failure after the source is repaired', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/work/parse-retry.mjs': 'export const = ;' });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(() => loader.require('./parse-retry.mjs', '/work/entry.cjs')).toThrow();
    vfs.writeFileSync(
      '/work/parse-retry.mjs',
      new TextEncoder().encode('export const value = 12;'),
    );

    expect(loader.require('./parse-retry.mjs', '/work/entry.cjs')).toMatchObject({ value: 12 });
  });

  it('retries a link failure after the dependency appears', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/link-retry.mjs': "import { value } from './link-missing.mjs'; export { value };",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(() => loader.require('./link-retry.mjs', '/work/entry.cjs')).toThrow();
    vfs.loadFixture({ '/work/link-missing.mjs': 'export const value = 13;' });

    expect(loader.require('./link-retry.mjs', '/work/entry.cjs')).toMatchObject({ value: 13 });
  });
});
