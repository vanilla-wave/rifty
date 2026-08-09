/**
 * Resolver-internal cache correctness (perf items #5 + #15).
 *
 * These caches are the HIGHEST-risk perf change: a stale entry silently breaks
 * guest writes / npm install (which do NOT fire `invalidate`). Each test below
 * locks one non-negotiable invalidation rule; the cache-hit-count tests prove
 * the cache exists at all, and the freshness/never-cache-miss tests prove it
 * never poisons resolution.
 *
 * #5 (Q-2026-06-06-320): package.json parse cache keyed by absolute path,
 *   FULLY cleared in `loader.invalidate()` (both arms).
 * #15 (Q-2026-06-06-321): resolution memo keyed `esm\0fromDir\0specifier`,
 *   FULLY cleared on ANY invalidate, NEVER caching not-found or the
 *   ERR_PACKAGE_PATH_NOT_EXPORTED throw.
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { ModuleLoadError } from './errors.ts';
import { createModuleLoader } from './loader.ts';

/**
 * Wrap a `MemoryFsSync` and count `readFileBytesSync` + `statSyncOrNull` calls
 * per absolute path. `reads` counts byte reads (proxy for parse work — #5);
 * `stats` counts existence probes (proxy for the node_modules walk — #15, the
 * resolution memo's unique signal, since `readResolved` always re-reads source
 * but a memo HIT skips the walk's `statSyncOrNull(candidateDir)`).
 */
function countingFs(): {
  fs: MemoryFsSync;
  reads: Map<string, number>;
  stats: Map<string, number>;
} {
  const fs = new MemoryFsSync();
  const reads = new Map<string, number>();
  const stats = new Map<string, number>();
  const originalRead = fs.readFileBytesSync.bind(fs);
  fs.readFileBytesSync = (path: string): Uint8Array => {
    reads.set(path, (reads.get(path) ?? 0) + 1);
    return originalRead(path);
  };
  const originalStat = fs.statSyncOrNull.bind(fs);
  fs.statSyncOrNull = ((path: string) => {
    stats.set(path, (stats.get(path) ?? 0) + 1);
    return originalStat(path);
  }) as typeof fs.statSyncOrNull;
  return { fs, reads, stats };
}

describe('resolver package.json parse cache (#5, Q-2026-06-06-320)', () => {
  it('parses a package.json once across N sibling imports from the same package', () => {
    const { fs, reads } = countingFs();
    fs.loadFixture({
      '/pkg/package.json': JSON.stringify({ name: 'p', type: 'commonjs' }),
      '/pkg/a.js': "module.exports = 'a';",
      '/pkg/b.js': "module.exports = 'b';",
      '/pkg/c.js': "module.exports = 'c';",
    });
    const loader = createModuleLoader(fs);

    loader.require('/pkg/a.js', '/pkg/__entry.js');
    loader.require('/pkg/b.js', '/pkg/__entry.js');
    loader.require('/pkg/c.js', '/pkg/__entry.js');

    // Without a cache, findPackageScope re-decodes+parses /pkg/package.json once
    // per sibling (3×). With the cache it is read exactly once.
    expect(reads.get('/pkg/package.json')).toBe(1);
  });

  it('edit package.json -> invalidate() -> next read returns the FRESH value (THE gate)', () => {
    const { fs } = countingFs();
    fs.loadFixture({
      // type:commonjs => the sibling .js classifies CJS.
      '/pkg/package.json': JSON.stringify({ name: 'p', type: 'commonjs' }),
      '/pkg/m.js': "module.exports = 'cjs-loaded';",
    });
    const loader = createModuleLoader(fs);

    // Warm the package.json cache (CJS classification, require succeeds).
    expect(loader.require('/pkg/m.js', '/pkg/__entry.js')).toBe('cjs-loaded');

    // Flip the package to type:module. Without invalidate the cached parse is
    // stale, so the .js still classifies CJS (cache hit on the OLD value).
    fs.loadFixture({ '/pkg/package.json': JSON.stringify({ name: 'p', type: 'module' }) });
    loader.invalidate('/pkg/m.js');
    // After invalidate the package.json cache must be cleared, so the resolver
    // re-parses and sees type:module => the .js now classifies ESM, and a sync
    // require() of an ESM module throws the directed UNSUPPORTED_PROTOCOL error.
    // (A stale cache would keep returning the CJS value 'cjs-loaded'.)
    expect(() => loader.require('/pkg/m.js', '/pkg/__entry.js')).toThrow(
      /require\(\) of ES Module/,
    );
  });

  it('full invalidate() (no id) also clears the package.json cache', () => {
    const { fs, reads } = countingFs();
    fs.loadFixture({
      '/pkg/package.json': JSON.stringify({ name: 'p', type: 'commonjs' }),
      '/pkg/m.js': "module.exports = 'v';",
    });
    const loader = createModuleLoader(fs);

    loader.require('/pkg/m.js', '/pkg/__entry.js');
    expect(reads.get('/pkg/package.json')).toBe(1);

    loader.invalidate();
    loader.require('/pkg/m.js', '/pkg/__entry.js');
    // Full clear forces the package.json to be re-parsed (count climbs to 2).
    expect(reads.get('/pkg/package.json')).toBe(2);
  });
});

describe('resolver package scope', () => {
  it.each([
    '/app/node_modules/dep/index.js',
    '/app/node_modules/@scope/dep/index.js',
    '/app/node_modules/outer/node_modules/dep/index.js',
  ])('does not inherit an outer type:module scope across node_modules for %s', (entry) => {
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/app/package.json': JSON.stringify({ type: 'module' }),
      [entry]: "module.exports = 'commonjs';",
    });
    const loader = createModuleLoader(fs);

    expect(loader.require(entry, '/app/[eval]')).toBe('commonjs');
  });

  it('still honors a package-owned type:module scope inside node_modules', () => {
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/app/package.json': JSON.stringify({ type: 'commonjs' }),
      '/app/node_modules/dep/package.json': JSON.stringify({ type: 'module' }),
      '/app/node_modules/dep/index.js': 'export default 42;',
    });
    const loader = createModuleLoader(fs);

    expect(loader.resolver.resolve('dep', { fromFile: '/app/[eval]', esm: false }).kind).toBe(
      'esm',
    );
  });
});

describe('resolver resolution cache (#15, Q-2026-06-06-321)', () => {
  // Drive `loader.resolver.resolve(...)` directly: this exercises the resolution
  // memo (`resolveSpecifierToFile`) in isolation from the registry / executed-
  // module cache (`require` would short-circuit on a 'loaded' record and never
  // re-resolve). `statSyncOrNull('/app/node_modules/dep')` fires once per
  // node_modules walk, so a memo HIT (which skips the walk) shows a flat count.
  const DEP_DIR = '/app/node_modules/dep';
  const fixture = {
    '/app/node_modules/dep/package.json': JSON.stringify({ name: 'dep', main: 'index.js' }),
    '/app/node_modules/dep/index.js': "module.exports = 'dep';",
  };

  it('resolves once per (esm,fromDir,specifier); a sibling re-resolve is a memo hit', () => {
    const { fs, stats } = countingFs();
    fs.loadFixture(fixture);
    const loader = createModuleLoader(fs);

    // Two different fromFiles in the SAME dir /app => same memo key, one walk.
    loader.resolver.resolve('dep', { fromFile: '/app/a.js', esm: false });
    loader.resolver.resolve('dep', { fromFile: '/app/b.js', esm: false });

    expect(stats.get(DEP_DIR)).toBe(1);
  });

  it('full invalidate() clears the resolution cache (re-walk after clear)', () => {
    const { fs, stats } = countingFs();
    fs.loadFixture(fixture);
    const loader = createModuleLoader(fs);

    loader.resolver.resolve('dep', { fromFile: '/app/a.js', esm: false });
    expect(stats.get(DEP_DIR)).toBe(1);

    loader.invalidate();
    loader.resolver.resolve('dep', { fromFile: '/app/a.js', esm: false });
    // Full clear drops the memo -> the node_modules walk re-runs.
    expect(stats.get(DEP_DIR)).toBe(2);
  });

  it('targeted invalidate(id) ALSO full-clears the resolution cache (input-keyed)', () => {
    const { fs, stats } = countingFs();
    fs.loadFixture(fixture);
    const loader = createModuleLoader(fs);

    loader.resolver.resolve('dep', { fromFile: '/app/a.js', esm: false });
    expect(stats.get(DEP_DIR)).toBe(1);

    // A targeted invalidate of an UNRELATED id cannot surgically evict a memo
    // keyed by (esm,fromDir,specifier), so it must FULL-clear the resolution
    // cache (distinct from transformCache's per-id delete).
    loader.invalidate('/some/unrelated/id.js');
    loader.resolver.resolve('dep', { fromFile: '/app/a.js', esm: false });
    expect(stats.get(DEP_DIR)).toBe(2);
  });

  it('NEVER caches a not-found: create the file after a miss (no invalidate) -> now resolves', () => {
    const fs = new MemoryFsSync();
    fs.loadFixture({ '/app/entry.js': "module.exports = 'entry';" });
    const loader = createModuleLoader(fs);

    // First resolve: ./late.js does not exist yet -> MODULE_NOT_FOUND.
    expect(() =>
      loader.resolver.resolve('./late.js', { fromFile: '/app/entry.js', esm: false }),
    ).toThrow(ModuleLoadError);

    // Guest write / npm install creates the file WITHOUT firing invalidate.
    fs.loadFixture({ '/app/late.js': "module.exports = 'late';" });

    // A cached absence would poison this forever; the miss must NOT be memoized.
    const resolved = loader.resolver.resolve('./late.js', {
      fromFile: '/app/entry.js',
      esm: false,
    });
    expect(resolved.id).toBe('/app/late.js');
  });

  it('CHARACTERIZATION: a memoised positive masks a now-closer node_modules entry until invalidate() (Q-2026-06-06-321 documented stale-id trade-off)', () => {
    // resolver.ts:159-178 documents the provisional stale-id trade-off
    // (Q-2026-06-06-321): SUCCESSFUL resolutions are memoised by
    // (esm,fromDir,specifier) and a HIT skips the node_modules walk entirely.
    // The deliberate consequence: if a CLOSER target appears after the memo is
    // warmed (without firing invalidate), resolution stays STALE-POSITIVE — the
    // walk is skipped, so the old id is returned. invalidate() is the only thing
    // that drops the memo. Pin that here so a future memo-eviction change cannot
    // silently alter it.
    const { fs } = countingFs();
    fs.loadFixture({
      '/app/node_modules/dep/package.json': JSON.stringify({ name: 'dep', main: 'index.js' }),
      '/app/node_modules/dep/index.js': "module.exports = 'far';",
      '/app/sub/a.js': "module.exports = 'a';",
    });
    const loader = createModuleLoader(fs);

    // Warm: `dep` from /app/sub walks up and resolves the FAR copy at /app.
    const first = loader.resolver.resolve('dep', { fromFile: '/app/sub/a.js', esm: false });
    expect(first.id).toBe('/app/node_modules/dep/index.js');

    // A closer copy appears under /app/sub/node_modules (guest write / install,
    // no invalidate). A fresh walk WOULD prefer it; the memo masks it.
    fs.loadFixture({
      '/app/sub/node_modules/dep/package.json': JSON.stringify({ name: 'dep', main: 'index.js' }),
      '/app/sub/node_modules/dep/index.js': "module.exports = 'near';",
    });

    // STALE-POSITIVE: memo hit returns the FAR id, not the now-closer one.
    const stale = loader.resolver.resolve('dep', { fromFile: '/app/sub/a.js', esm: false });
    expect(stale.id).toBe('/app/node_modules/dep/index.js');

    // invalidate() drops the memo -> the re-walk now finds the CLOSER copy.
    loader.invalidate();
    const fresh = loader.resolver.resolve('dep', { fromFile: '/app/sub/a.js', esm: false });
    expect(fresh.id).toBe('/app/sub/node_modules/dep/index.js');
  });

  it('NEVER caches the ERR_PACKAGE_PATH_NOT_EXPORTED throw (re-throws on repeat)', () => {
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/app/node_modules/pkg/package.json': JSON.stringify({
        name: 'pkg',
        exports: { '.': './index.js' },
      }),
      '/app/node_modules/pkg/index.js': "module.exports = 'pkg';",
      '/app/node_modules/pkg/secret.js': "module.exports = 'secret';",
      '/app/entry.js': "module.exports = 'entry';",
    });
    const loader = createModuleLoader(fs);

    // './secret' is not in the exports map -> ERR_PACKAGE_PATH_NOT_EXPORTED, twice
    // (the throw propagates before the memo `set`, so it is structurally
    // un-cacheable — both calls must throw identically).
    expect(() =>
      loader.resolver.resolve('pkg/secret', { fromFile: '/app/entry.js', esm: false }),
    ).toThrow(/not defined by 'exports'/);
    expect(() =>
      loader.resolver.resolve('pkg/secret', { fromFile: '/app/entry.js', esm: false }),
    ).toThrow(/not defined by 'exports'/);
  });
});
