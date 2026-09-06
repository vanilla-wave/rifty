import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoaderWithBuiltinOverrides } from './loader.ts';

describe('loader-local builtin overrides', () => {
  it('keeps separate lazy require/import authorities for consecutive runs', async () => {
    const first = Object.freeze({ marker: 'first' });
    const second = Object.freeze({ marker: 'second' });
    const firstLoader = createModuleLoaderWithBuiltinOverrides(
      new MemoryFsSync(),
      { cwd: '/work' },
      new Map([['node:path', first]]),
    );
    const firstCjsModule = firstLoader.require('node:module') as {
      readonly createRequire: (from: string) => (id: string) => unknown;
    };
    const firstEsmModule = await firstLoader.import('node:module');
    const secondLoader = createModuleLoaderWithBuiltinOverrides(
      new MemoryFsSync(),
      { cwd: '/work' },
      new Map([['node:path', second]]),
    );

    expect(firstLoader.require('node:path')).toBe(first);
    expect(secondLoader.require('node:path')).toBe(second);
    expect((await firstLoader.import('node:path')).default).toBe(first);
    expect((await secondLoader.import('node:path')).default).toBe(second);
    expect(firstCjsModule.createRequire('/work/late.cjs')('node:path')).toBe(first);
    expect(
      (firstEsmModule.createRequire as (from: string) => (id: string) => unknown)('/work/late.mjs')(
        'node:path',
      ),
    ).toBe(first);
  });
});
