import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from './database-sync.ts';
import {
  getSqliteEngine,
  initSqliteEngine,
  initSqliteEngineSync,
  isSqliteEngineReady,
} from './engine.ts';

/**
 * SYNCHRONOUS bring-up contract.
 *
 * Spike-proven glue mechanics this suite pins: sql.js's `initSqlJs(config)`
 * uses the config object AS the emscripten Module; with an `instantiateWasm`
 * hook doing `new WebAssembly.Instance(new WebAssembly.Module(bytes))` the
 * WHOLE bring-up (instantiate → run → api.js attaching `Database`) completes
 * synchronously INSIDE the `initSqlJs` call — `config.Database` is set before
 * it returns (the returned promise is a formality resolved via postRun).
 *
 * Node realm here proves the GLUE semantics only. The browser fact that sync
 * `new WebAssembly.Module` is legal in WORKERS (main thread restricts large
 * sync compiles) is an e2e concern, not this unit's.
 *
 * State: the sql.js glue memoises per process (= per vitest fork = per test
 * file) and IGNORES configs after the first call, so this file owns exactly
 * ONE bring-up — the first test performs it, later tests reuse (ordered).
 */

const wasmBytes = readFileSync(createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'));

describe('initSqliteEngineSync (ordered: first test owns the single bring-up)', () => {
  it('brings the engine up fully synchronously — zero awaits between call and asserts', () => {
    expect(isSqliteEngineReady()).toBe(false);
    const engine = initSqliteEngineSync(wasmBytes);
    // Same synchronous frame as the call above — the load-bearing property.
    expect(isSqliteEngineReady()).toBe(true);
    expect(getSqliteEngine()).toBe(engine);
    expect(typeof engine.Database).toBe('function');

    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('hello');");
    const rows = db.prepare('SELECT id, v FROM t').all();
    db.close();
    expect(rows).toEqual([{ id: 1, v: 'hello' }]);
  });

  it('is memoised: a second sync call reuses the ready engine (bytes ignored)', () => {
    const again = initSqliteEngineSync(new Uint8Array(0));
    expect(again).toBe(getSqliteEngine());
  });

  it('async initSqliteEngine() after sync bring-up resolves to the same handle', async () => {
    const viaAsync = await initSqliteEngine();
    expect(viaAsync).toBe(getSqliteEngine());
  });
});
