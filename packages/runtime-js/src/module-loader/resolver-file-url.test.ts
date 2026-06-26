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
  });
});
