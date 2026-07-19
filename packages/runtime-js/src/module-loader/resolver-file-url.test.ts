import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('resolver file: URL imports', () => {
  it('resolves file:/// URLs into VFS absolute paths', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/app/package.json': JSON.stringify({ type: 'module' }),
      '/app/mod.mjs': 'export default 42;\n',
    });
    const loader = createModuleLoader(vfs, { cwd: '/app' });

    const ns = (await loader.import('file:///app/mod.mjs', '/app/entry.mjs')) as {
      default: number;
    };
    expect(ns.default).toBe(42);
    await expect(loader.import('FiLe:///app/mod.mjs', '/app/entry.mjs')).resolves.toBe(ns);
  });

  it('keeps CJS require()/require.resolve() path-only for URL-like specifiers', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/app/real.js': 'module.exports = 42;\n',
      '/app/main.js': `
        const out = [];
        const urlish = ['file:///app/real.js', 'FiLe:///app/real.js', 'data:text/javascript,1'];
        for (const specifier of urlish) {
          try { require(specifier); out.push('LOADED'); }
          catch (error) { out.push(error.code); }
          try { require.resolve(specifier); out.push('FOUND'); }
          catch (error) { out.push(error.code); }
        }
        module.exports = out;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/app' });

    expect(loader.require('./main.js', '/app/entry.js')).toEqual(
      Array.from({ length: 6 }, () => 'MODULE_NOT_FOUND'),
    );
  });

  it.each(['data:', 'DaTa:'])(
    'keeps unsupported %s URLs on the same loud boundary',
    async (scheme) => {
      const vfs = new MemoryFsSync();
      const loader = createModuleLoader(vfs, { cwd: '/app' });

      await expect(
        loader.import(`${scheme}text/javascript,export default 42`, '/app/entry.mjs'),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
    },
  );
});
