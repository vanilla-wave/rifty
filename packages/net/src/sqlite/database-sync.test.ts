import { NotImplementedError } from '@rifty/io';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from './database-sync.ts';
import { initSqliteEngine } from './engine.ts';

/**
 * Unit assertions for the `StatementSync` members the sql.js engine GENUINELY
 * cannot back — the no-silent-stubs half of the run/get/iterate/columns task
 * (ADR-0065 D4). These are NOT parity assertions: Node returns a value where
 * rifty throws, so the two diverge BY DESIGN, and a parity case would (rightly)
 * fail. Instead we pin the loud throw so a future regression that quietly fakes
 * a value is caught here, and the compat-matrix records each as ❌.
 *
 * Two surfaces throw:
 *
 *   - `setReadBigInts(true)` — the prebuilt sql.js WASM stores every INTEGER in
 *     a JS `number`, so it has NO bigint read mode. Coercing those numbers to
 *     `BigInt` would be a SILENT precision lie above `Number.MAX_SAFE_INTEGER`
 *     (the number is already lossy before the cast). So `setReadBigInts(true)`
 *     throws `NotImplementedError('sqlite.Statement.setReadBigInts(true)')`
 *     rather than fall back to a faked value. The `false` path (the default,
 *     and effect's SafeIntegers-default state) stays a plain-`number`
 *     pass-through and is pinned by the parity case.
 *   - `columns()` — Node returns the full per-column metadata
 *     (`{ column, database, name, table, type }`), which needs SQLite's
 *     `SQLITE_ENABLE_COLUMN_METADATA` build (the `sqlite3_column_table_name` /
 *     `_database_name` / `_origin_name` / `_decltype` exports). The prebuilt
 *     sql.js WASM is compiled WITHOUT that flag (it exposes only
 *     `sqlite3_column_name`), so the table/database/decltype fields are
 *     unavailable. Returning a partial shape would be a silent stub, so
 *     `columns()` throws `NotImplementedError('sqlite.StatementSync.columns')`.
 *
 * The engine must be brought up before constructing a `DatabaseSync` (the
 * synchronous-over-async-WASM bridge, ADR-0065 D1), so `beforeAll` awaits
 * `initSqliteEngine()`.
 */
describe('StatementSync no-silent-stubs throws (ADR-0065 D4)', () => {
  beforeAll(async () => {
    await initSqliteEngine();
  });

  let db: DatabaseSync | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('setReadBigInts(true) throws NotImplementedError (no silent number→BigInt fallback)', () => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('a', 5);
    const stmt = db.prepare('SELECT n FROM t WHERE id = ?');

    let thrown: unknown;
    try {
      stmt.setReadBigInts(true);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as NotImplementedError).feature).toBe('sqlite.Statement.setReadBigInts(true)');
  });

  it('setReadBigInts(false) does NOT throw (default plain-number path stays live)', () => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('a', 5);
    const stmt = db.prepare('SELECT n FROM t WHERE id = ?');

    expect(() => stmt.setReadBigInts(false)).not.toThrow();
    expect(stmt.get('a')).toEqual({ n: 5 });
  });

  it('columns() throws NotImplementedError (prebuilt sql.js WASM lacks column metadata)', () => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');
    const stmt = db.prepare('SELECT id, n FROM t');

    let thrown: unknown;
    try {
      stmt.columns();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as NotImplementedError).feature).toBe('sqlite.StatementSync.columns');
  });
});
