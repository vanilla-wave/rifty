/**
 * Persistent ESM transform cache hook (ADR-0200, resolves Q-2026-05-30-202).
 * The loader consults an injected cross-boot store on an in-memory miss and
 * validates every hit by EXACT source equality at its own boundary — a store
 * can degrade or vanish but never poison execution (fault: poisoned-cache).
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import * as esmAst from './esm-ast.ts';
import { type PersistentEsmTransformCacheEntry, createModuleLoader } from './loader.ts';

const SOURCE = 'export const m = 7;\n';

function fixtureVfs(): MemoryFsSync {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({
    '/work/package.json': JSON.stringify({ type: 'module' }),
    '/work/m.js': SOURCE,
  });
  return vfs;
}

function storeOf(entries: Record<string, PersistentEsmTransformCacheEntry>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get: vi.fn((id: string) => map.get(id)),
    put: vi.fn((id: string, entry: PersistentEsmTransformCacheEntry) => {
      map.set(id, entry);
    }),
  };
}

describe('createModuleLoader persistent ESM transform cache (ADR-0200)', () => {
  it('a source-matching stored entry skips the acorn parse entirely', async () => {
    // A REAL result from a previous "boot" — the store replays it verbatim.
    const previousBoot = esmAst.transformEsm(SOURCE, '/work/m.js');
    const store = storeOf({ '/work/m.js': { source: SOURCE, result: previousBoot } });
    const spy = vi.spyOn(esmAst, 'transformEsm');
    try {
      const loader = createModuleLoader(fixtureVfs(), {
        cwd: '/work',
        persistentEsmTransformCache: store,
      });
      const ns = await loader.import('./m.js', '/work/__entry__.js');
      expect(ns.m).toBe(7);
      expect(spy).not.toHaveBeenCalled();
      expect(store.put).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('a stale stored entry (source changed under the same id) recomputes and overwrites', async () => {
    const staleResult = esmAst.transformEsm('export const m = 1;\n', '/work/m.js');
    const store = storeOf({
      '/work/m.js': { source: 'export const m = 1;\n', result: staleResult },
    });
    const spy = vi.spyOn(esmAst, 'transformEsm');
    try {
      const loader = createModuleLoader(fixtureVfs(), {
        cwd: '/work',
        persistentEsmTransformCache: store,
      });
      const ns = await loader.import('./m.js', '/work/__entry__.js');
      expect(ns.m).toBe(7); // the CURRENT source ran, never the stale result
      expect(spy).toHaveBeenCalledTimes(1);
      expect(store.put).toHaveBeenCalledTimes(1);
      expect(store.map.get('/work/m.js')?.source).toBe(SOURCE);
    } finally {
      spy.mockRestore();
    }
  });

  it('a miss computes once, publishes to the store, and warms the in-memory cache', async () => {
    const store = storeOf({});
    const spy = vi.spyOn(esmAst, 'transformEsm');
    try {
      const loader = createModuleLoader(fixtureVfs(), {
        cwd: '/work',
        persistentEsmTransformCache: store,
      });
      const ns = await loader.import('./m.js', '/work/__entry__.js');
      expect(ns.m).toBe(7);
      expect(store.put).toHaveBeenCalledTimes(1);
      // Re-execute with a warm in-memory cache: neither acorn nor the store fire.
      loader.registry.invalidate('/work/m.js');
      store.get.mockClear();
      await loader.loadById('/work/m.js', true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(store.get).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('loader.invalidate(id) falls back to the store on the next load (source still valid)', async () => {
    const previousBoot = esmAst.transformEsm(SOURCE, '/work/m.js');
    const store = storeOf({ '/work/m.js': { source: SOURCE, result: previousBoot } });
    const spy = vi.spyOn(esmAst, 'transformEsm');
    try {
      const loader = createModuleLoader(fixtureVfs(), {
        cwd: '/work',
        persistentEsmTransformCache: store,
      });
      await loader.import('./m.js', '/work/__entry__.js');
      loader.invalidate('/work/m.js');
      const ns = await loader.loadById('/work/m.js', true);
      expect(ns.m).toBe(7);
      // The persistent entry is still source-valid — no re-parse needed.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
