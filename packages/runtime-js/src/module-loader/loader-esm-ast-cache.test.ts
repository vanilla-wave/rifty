/**
 * Unit test for the loader's id-keyed ESM AST cache (perf #16,
 * Q-2026-05-30-202). `transformEsm` (acorn parse + walk) is the heaviest
 * per-module CPU step; the loader wraps it in an id-keyed cache dropped in
 * lockstep with `transformCache` / the registry.
 *
 * Drives `transformEsm` through a spy on the `esm-ast` module namespace (the
 * loader holds a live binding to the named export). The registry record is
 * dropped between loads so `executeEsm` re-runs and would re-parse WITHOUT the
 * AST cache (the RED leg); with the cache the parse fires once until
 * `loader.invalidate()` drops it.
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import * as esmAst from './esm-ast.ts';
import { createModuleLoader } from './loader.ts';

describe('createModuleLoader ESM AST cache (#16, Q-2026-05-30-202)', () => {
  it('parses each id once across re-executes, and drops the AST cache on invalidate', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/m.js': 'export const m = 7;\n',
    });

    const spy = vi.spyOn(esmAst, 'transformEsm');
    try {
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      // First import: parse fires once, registry caches the executed module.
      const first = await loader.import('./m.js', '/work/__entry__.js');
      expect(first.m).toBe(7);
      expect(spy).toHaveBeenCalledTimes(1);

      // Drop ONLY the registry record (not the loader caches) so executeEsm runs
      // again while the AST cache stays warm. With the cache the acorn parse is
      // NOT re-run (count stays 1); without it the parse re-fires (RED leg).
      loader.registry.invalidate('/work/m.js');
      const again = await loader.loadById('/work/m.js', true);
      expect(again.m).toBe(7);
      expect(spy).toHaveBeenCalledTimes(1);

      // loader.invalidate(id) drops the AST cache too -> next load re-parses.
      loader.invalidate('/work/m.js');
      const afterInvalidate = await loader.loadById('/work/m.js', true);
      expect(afterInvalidate.m).toBe(7);
      expect(spy).toHaveBeenCalledTimes(2);

      // Full invalidate() also clears the AST cache.
      loader.registry.invalidate('/work/m.js');
      loader.invalidate();
      const afterFull = await loader.loadById('/work/m.js', true);
      expect(afterFull.m).toBe(7);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });
});
