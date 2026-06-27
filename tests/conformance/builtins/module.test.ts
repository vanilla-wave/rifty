import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('node:module', () => {
  it('exposes compile-cache status constants and a non-throwing disabled result', () => {
    const loader = setup({
      '/app/main.js': `
        const mod = require('node:module');
        const result = mod.enableCompileCache();
        module.exports = {
          constants: mod.constants.compileCacheStatus,
          result,
          dir: mod.getCompileCacheDir(),
        };
      `,
    });
    const out = loader.require('./main.js', '/app/entry.js') as {
      constants: Record<string, number>;
      result: { status: number; message?: string; directory?: string };
      dir: unknown;
    };

    expect(out.constants).toMatchObject({ FAILED: 0, ENABLED: 1, ALREADY_ENABLED: 2, DISABLED: 3 });
    expect(out.result).toMatchObject({
      status: out.constants.FAILED,
      message: expect.stringContaining('compile cache'),
    });
    expect(out.result.directory).toBeUndefined();
    expect(out.dir).toBeUndefined();
  });

  it('flushCompileCache is a quiet no-op when compile cache is unavailable', () => {
    const loader = setup({
      '/app/main.js':
        "const mod = require('node:module'); mod.flushCompileCache(); module.exports = 'ok';",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('ok');
  });

  it('isBuiltin reflects the runtime-js builtin registry', () => {
    const loader = setup({
      '/app/main.js': `
        const mod = require('node:module');
        module.exports = [
          mod.isBuiltin('node:path'),
          mod.isBuiltin('path'),
          mod.isBuiltin('node:not-a-real-builtin'),
        ];
      `,
    });
    expect(loader.require('./main.js', '/app/entry.js')).toEqual([true, true, false]);
  });

  it('createRequire(import.meta.url) binds an ESM module back to the same VFS loader', async () => {
    const loader = setup({
      '/app/main.mjs': `
        import { createRequire } from 'node:module';
        const require = createRequire(import.meta.url);
        const dep = require('./dep.cjs');
        export const value = dep.value;
        export const resolved = require.resolve('./dep.cjs');
      `,
      '/app/dep.cjs': "module.exports = { value: 'from-cjs' };",
    });

    const ns = await loader.import('./main.mjs', '/app/entry.mjs');

    expect(ns.value).toBe('from-cjs');
    expect(ns.resolved).toBe('/app/dep.cjs');
  });
});
