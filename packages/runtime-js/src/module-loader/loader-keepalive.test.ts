/**
 * Verifies that `loader.import()` refs the keepalive while in flight and
 * unrefs once settled (resolve or reject) — Task 6 of child-realm-async-lifecycle.
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { createModuleLoader } from './loader.ts';

afterEach(() => resetKeepalive());

describe('loader keeps the loop alive while a dynamic import is in flight', () => {
  it('refs during import() and unrefs once it settles', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/m.mjs': 'export const x = 1;\n',
    });

    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const p = loader.import('/work/m.mjs', '/work/m.mjs');
    expect(activeRefs()).toBeGreaterThanOrEqual(1);
    await p;
    expect(activeRefs()).toBe(0);
  });

  it('unrefs even when the import rejects', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
    });

    const loader = createModuleLoader(vfs, { cwd: '/work' });
    await expect(loader.import('/work/missing.mjs', '/work/missing.mjs')).rejects.toBeDefined();
    expect(activeRefs()).toBe(0);
  });
});
