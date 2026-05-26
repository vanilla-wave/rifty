/**
 * Unit tests for `ModuleLoader.invalidate(id?)`.
 *
 * Closes the "ModuleLoader recreated per `load-fixture`" finding from the
 * 2026-05-26 architecture review (Tier 1 #4). The loader is the public seam
 * that hides the registry — callers (worker-entry, future HMR layer) should
 * never need to reach into `loader.registry` to drop an entry.
 *
 * Covers:
 *  - full invalidate behaves like the historical "throw away the loader"
 *    pattern (everything re-executes)
 *  - targeted invalidate re-runs only the named module's body
 *  - re-execution observes the new source, not the cached exports
 */
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';
import { MemorySyncVfs } from './memory-sync-vfs.ts';

describe('ModuleLoader.invalidate(id?)', () => {
  it('full invalidate forces every module to re-execute on next require()', () => {
    const vfs = new MemorySyncVfs();
    vfs.loadFixture({
      '/a.js': "globalThis.__count_a = (globalThis.__count_a ?? 0) + 1; module.exports = 'A';",
      '/b.js': "globalThis.__count_b = (globalThis.__count_b ?? 0) + 1; module.exports = 'B';",
    });
    const loader = createModuleLoader(vfs);

    (globalThis as unknown as Record<string, number>).__count_a = 0;
    (globalThis as unknown as Record<string, number>).__count_b = 0;

    loader.require('./a.js', '/entry.js');
    loader.require('./b.js', '/entry.js');
    expect((globalThis as unknown as Record<string, number>).__count_a).toBe(1);
    expect((globalThis as unknown as Record<string, number>).__count_b).toBe(1);

    // Second require without invalidation: cached.
    loader.require('./a.js', '/entry.js');
    loader.require('./b.js', '/entry.js');
    expect((globalThis as unknown as Record<string, number>).__count_a).toBe(1);
    expect((globalThis as unknown as Record<string, number>).__count_b).toBe(1);

    loader.invalidate();

    loader.require('./a.js', '/entry.js');
    loader.require('./b.js', '/entry.js');
    expect((globalThis as unknown as Record<string, number>).__count_a).toBe(2);
    expect((globalThis as unknown as Record<string, number>).__count_b).toBe(2);
  });

  it('targeted invalidate re-runs only the named module; siblings stay cached', () => {
    const vfs = new MemorySyncVfs();
    vfs.loadFixture({
      '/a.js': "globalThis.__hit_a = (globalThis.__hit_a ?? 0) + 1; module.exports = 'A';",
      '/b.js': "globalThis.__hit_b = (globalThis.__hit_b ?? 0) + 1; module.exports = 'B';",
    });
    const loader = createModuleLoader(vfs);

    (globalThis as unknown as Record<string, number>).__hit_a = 0;
    (globalThis as unknown as Record<string, number>).__hit_b = 0;

    loader.require('./a.js', '/entry.js');
    loader.require('./b.js', '/entry.js');
    expect((globalThis as unknown as Record<string, number>).__hit_a).toBe(1);
    expect((globalThis as unknown as Record<string, number>).__hit_b).toBe(1);

    // Invalidate only /a.js — /b.js must stay cached.
    loader.invalidate('/a.js');

    loader.require('./a.js', '/entry.js');
    loader.require('./b.js', '/entry.js');
    expect((globalThis as unknown as Record<string, number>).__hit_a).toBe(2);
    expect((globalThis as unknown as Record<string, number>).__hit_b).toBe(1);
  });

  it('re-execution after invalidate observes the new source, not the cached exports', () => {
    const vfs = new MemorySyncVfs();
    vfs.setFile('/m.js', "module.exports = 'v1';");
    const loader = createModuleLoader(vfs);

    expect(loader.require('./m.js', '/entry.js')).toBe('v1');

    // Update the file and invalidate — next require should see v2.
    vfs.setFile('/m.js', "module.exports = 'v2';");
    expect(loader.require('./m.js', '/entry.js')).toBe('v1'); // still cached

    loader.invalidate('/m.js');
    expect(loader.require('./m.js', '/entry.js')).toBe('v2');
  });
});
