import { describe, expect, it } from 'vitest';
import { getSqliteEngine, initSqliteEngine, isSqliteEngineReady } from './engine.ts';

/**
 * Init contract for the sql.js-backed `node:sqlite` engine (ADR-0065).
 *
 * This is a UNIT test of OUR sync-surface-over-async-WASM bridge, NOT a test
 * of Node's `node:sqlite` behaviour. The load-bearing property: a synchronous
 * `DatabaseSync` constructor (which opencode's boot path calls at Effect
 * layer-build time) needs a SYNCHRONOUS handle to the SQL engine, but the
 * WASM module can only be brought up asynchronously. So the contract is:
 *
 *   - `initSqliteEngine()` is async, resolves once, and is memoised — repeated
 *     calls hand back the SAME `SqlJsStatic` (one WASM bring-up per process).
 *   - AFTER init resolves, the synchronous `getSqliteEngine()` returns that
 *     same handle, whose `.Database` is a usable constructor.
 *   - BEFORE init, `getSqliteEngine()` throws a CLEAR "engine not initialized"
 *     error — never a silent `null`/`undefined` (no silent stubs).
 *
 * These four assertions, taken together, prove the bridge the synchronous
 * `DatabaseSync` ctor will depend on.
 *
 * Ordering note: the "before init" assertion runs first and depends on the
 * module-level memo being empty. Because init memoises process-wide, this
 * suite is the sole owner of that state within the file; the throw-before-init
 * case is asserted before any `initSqliteEngine()` call.
 */
describe('sqlite engine init contract (ADR-0065)', () => {
  it('getSqliteEngine() throws a clear error before init (not a silent null)', () => {
    expect(isSqliteEngineReady()).toBe(false);
    let thrown: unknown;
    try {
      getSqliteEngine();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/engine not initialized/i);
  });

  it('initSqliteEngine() resolves to a SqlJsStatic with a Database constructor', async () => {
    const sql = await initSqliteEngine();
    expect(sql).not.toBeNull();
    expect(typeof sql.Database).toBe('function');
  });

  it('initSqliteEngine() is idempotent/memoised: same handle across calls', async () => {
    const a = await initSqliteEngine();
    const b = await initSqliteEngine();
    expect(b).toBe(a);
  });

  it('getSqliteEngine() returns the same non-null Database factory after init', async () => {
    const fromInit = await initSqliteEngine();
    expect(isSqliteEngineReady()).toBe(true);
    const fromSync = getSqliteEngine();
    expect(fromSync).toBe(fromInit);
    expect(typeof fromSync.Database).toBe('function');
  });

  it('the resolved engine can construct an in-memory Database synchronously', async () => {
    const sql = await initSqliteEngine();
    const db = new sql.Database();
    db.run('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
    db.run('INSERT INTO t(v) VALUES (?)', ['hello']);
    const rows = db.exec('SELECT id, v FROM t');
    db.close();
    expect(rows).toEqual([{ columns: ['id', 'v'], values: [[1, 'hello']] }]);
  });
});
