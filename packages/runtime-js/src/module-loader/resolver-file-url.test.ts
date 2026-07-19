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
