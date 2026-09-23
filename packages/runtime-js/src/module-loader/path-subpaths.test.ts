import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('path builtin subpath registration', () => {
  it.each(['posix', 'win32'] as const)(
    'loads the existing %s object through CJS and ESM',
    async (flavour) => {
      const loader = createModuleLoader(new MemoryFsSync());
      const path = loader.require('node:path') as Record<string, unknown>;
      for (const prefix of ['', 'node:']) {
        const specifier = `${prefix}path/${flavour}`;
        expect(loader.require(specifier)).toBe(path[flavour]);
        expect((await loader.import(specifier)).default).toBe(path[flavour]);
      }
    },
  );
});
