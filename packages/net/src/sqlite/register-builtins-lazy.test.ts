import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSync as DatabaseSyncType } from './database-sync.ts';

/**
 * Lazy engine bring-up through the `node:sqlite` builtin factory (backlog:
 * net/sqlite-lazy-engine). Kills the preset flag: a host realm installs
 * `setSqliteEngineSyncProvider(() => wasmBytes)` at boot (cheap — no wasm
 * cost), and the FIRST `require('node:sqlite')` pays the sync bring-up.
 *
 * Registry + engine memos are module-level singletons → every test takes a
 * fresh module graph (`vi.resetModules` + dynamic import). The sql.js glue
 * memoises per process and ignores later configs, so exactly ONE test here
 * may bring the wasm up (the provider test); the no-provider test never
 * touches the glue — ordering is load-bearing only in that sense.
 */

const wasmBytes = readFileSync(createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'));

type SqliteNamespace = { DatabaseSync: typeof DatabaseSyncType };

describe('node:sqlite builtin factory lazy bring-up', () => {
  it('no provider + engine not ready → require succeeds, constructor throws loud, message names the seam', async () => {
    vi.resetModules();
    await import('./register-builtins.ts');
    const { loadBuiltin } = await import('@riftydev/io');
    const engine = await import('./engine.ts');

    const ns = loadBuiltin('node:sqlite');
    expect(ns).not.toBeNull();
    expect(engine.isSqliteEngineReady()).toBe(false);

    const { DatabaseSync } = ns as unknown as SqliteNamespace;
    let thrown: unknown;
    try {
      new DatabaseSync(':memory:');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/engine not initialized/i);
    expect((thrown as Error).message).toContain('setSqliteEngineSyncProvider');
  });

  it('provider installed → first require brings the engine up; DatabaseSync constructible in the same frame', async () => {
    vi.resetModules();
    const engine = await import('./engine.ts');
    const provider = vi.fn(() => wasmBytes);
    engine.setSqliteEngineSyncProvider(provider);
    expect(provider).not.toHaveBeenCalled(); // installing is cheap: no wasm cost yet

    await import('./register-builtins.ts');
    const { loadBuiltin } = await import('@riftydev/io');
    expect(engine.isSqliteEngineReady()).toBe(false); // registration alone must not init

    const ns = loadBuiltin('node:sqlite'); // ← first require pays the bring-up
    expect(provider).toHaveBeenCalledTimes(1);
    expect(engine.isSqliteEngineReady()).toBe(true);

    // Immediately constructible — same synchronous frame as the require.
    const { DatabaseSync } = ns as unknown as SqliteNamespace;
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('lazy');");
    const rows = db.prepare('SELECT id, v FROM t').all();
    db.close();
    expect(rows).toEqual([{ id: 1, v: 'lazy' }]);

    // Second require: cached namespace, no second bring-up.
    const nsAgain = loadBuiltin('node:sqlite');
    expect(nsAgain).toBe(ns);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
