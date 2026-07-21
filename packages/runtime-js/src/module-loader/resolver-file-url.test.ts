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

  // Oracle: TypeScript 5.9 `resolveModuleName` (the ADR-0066/0170 ceiling) and
  // tsconfig-paths@4 both match URL-like CJS bare names through exact aliases
  // and `*` wildcards — the extension must not special-case them out of the
  // bare fall-through.
  it('lets explicit alias patterns match URL-like CJS bare names', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/app/mapped-exact.js': 'module.exports = "exact";\n',
      '/app/star/file:/w.js': 'module.exports = "star";\n',
      '/app/main.js': `
        const out = {
          exact: require('file:///exact.js'),
          exactResolved: require.resolve('file:///exact.js'),
          star: require('file:///w.js'),
        };
        try { require('data:text/javascript,1'); out.data = 'LOADED'; }
        catch (error) { out.data = error.code; }
        module.exports = out;
      `,
    });
    const loader = createModuleLoader(vfs, {
      cwd: '/app',
      paths: { 'file:///exact.js': '/app/mapped-exact.js', '*': '/app/star/*' },
    });

    expect(loader.require('./main.js', '/app/entry.js')).toEqual({
      exact: 'exact',
      exactResolved: '/app/mapped-exact.js',
      star: 'star',
      // `*` matched but '/app/star/data:text/javascript,1' is a miss — same
      // attempt-then-MODULE_NOT_FOUND as tsconfig-paths.
      data: 'MODULE_NOT_FOUND',
    });
  });

  // Oracle: TypeScript treats a `scheme://` name as ROOTED (`getRootLength`),
  // so `combinePaths` never prepends baseUrl and the literal lookup misses —
  // NOT_RESOLVED in every moduleResolution mode. tsconfig-paths@4 joins it
  // blindly and resolves; the ADRs pin tsc, not the runtime shim.
  it('keeps baseUrl blind to URL-rooted names while resolving plain bare names', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/app/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.' } }),
      '/app/file:/bu.js': 'module.exports = "bu";\n',
      '/app/base-target.js': 'module.exports = "plainbase";\n',
      '/app/main.js': `
        const out = { plain: require('base-target') };
        try { out.fileUrl = require('file:///bu.js'); }
        catch (error) { out.fileUrl = error.code; }
        module.exports = out;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/app', autoDiscoverTsconfigPaths: true });

    expect(loader.require('./main.js', '/app/entry.js')).toEqual({
      plain: 'plainbase',
      fileUrl: 'MODULE_NOT_FOUND',
    });
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
