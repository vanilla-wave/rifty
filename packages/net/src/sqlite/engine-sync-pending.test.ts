import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

/**
 * Sync-vs-async init interleavings.
 *
 * Decision pinned here: `initSqliteEngineSync` REUSES a ready engine but
 * THROWS LOUD while an async bring-up is pending — sql.js's glue memoises one
 * module per realm and silently ignores later configs, so a second (sync)
 * bring-up is impossible; pretending otherwise would hand back a not-ready
 * engine (silent stub, forbidden).
 *
 * Ordered suite: the first test's async init primes BOTH memos (ours and the
 * sql.js glue's process-wide one); the last test then pins the cross-instance
 * loud error a FRESH engine module hits against the stale glue memo.
 */

const wasmBytes = readFileSync(createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'));

describe('initSqliteEngineSync vs async init (ordered)', () => {
  it('throws loud while an async initSqliteEngine() is still PENDING', async () => {
    const engine = await import('./engine.ts');
    const pending = engine.initSqliteEngine();
    expect(engine.isSqliteEngineReady()).toBe(false);
    expect(() => engine.initSqliteEngineSync(wasmBytes)).toThrowError(/pending/i);
    await pending;
  });

  it('reuses the engine once the async init has RESOLVED', async () => {
    const engine = await import('./engine.ts');
    const viaAsync = await engine.initSqliteEngine();
    const viaSync = engine.initSqliteEngineSync(wasmBytes);
    expect(viaSync).toBe(viaAsync);
  });

  it('fresh engine module + already-primed sql.js glue → loud error (glue ignores the sync config)', async () => {
    vi.resetModules();
    const fresh = await import('./engine.ts');
    expect(fresh.isSqliteEngineReady()).toBe(false);
    expect(() => fresh.initSqliteEngineSync(wasmBytes)).toThrowError(
      /did not complete synchronously/i,
    );
  });
});
