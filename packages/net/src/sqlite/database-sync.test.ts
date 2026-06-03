import { NotImplementedError } from '@riftydev/io';
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

/**
 * The default `setReadBigInts(false)` read path must REFUSE to hand back a
 * truncated INTEGER, throwing Node's `RangeError` / `ERR_OUT_OF_RANGE` for a
 * value past `Number.MAX_SAFE_INTEGER` instead (ADR-0065 finding #2). This is a
 * package-level pin of the same behaviour the head-to-head parity case
 * (`cases/sqlite/read-bigint-overflow.case.ts`) verifies against Node v24 — it
 * catches a regression that quietly re-truncates without needing the parity
 * harness. The boundary (first value Node refuses is `2^53`, the safe ceiling
 * `Number.MAX_SAFE_INTEGER` reads fine) was verified against real `node:sqlite`.
 *
 * The exact 64-bit integers are written via SQL integer LITERALS (not bound
 * `bigint` params — the shim's bind-param type does not model `bigint`, a
 * separate surface concern from this read guard). sql.js stores them and returns
 * a JS number that is already truncated past `2^53`, so the read guard detects an
 * integer-valued non-safe number and throws. A `code: string` cast on the caught
 * error reads the Node-shaped `.code` without an `any`.
 */
type CodedError = Error & { code?: string };

describe('StatementSync setReadBigInts(false) integer-overflow guard (ADR-0065 finding #2)', () => {
  beforeAll(async () => {
    await initSqliteEngine();
  });

  let db: DatabaseSync | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  /** Seed a single INTEGER row via a literal and return a reader for its value. */
  function selectBig(literal: string): () => unknown {
    const local = new DatabaseSync(':memory:');
    db = local;
    local.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, big INTEGER NOT NULL);');
    local.exec(`INSERT INTO t (id, big) VALUES (1, ${literal});`);
    const stmt = local.prepare('SELECT big FROM t WHERE id = ?');
    return () => stmt.get(1);
  }

  /** Capture whatever `fn` throws, or `undefined` if it does not throw. */
  function caught(fn: () => unknown): unknown {
    try {
      fn();
      return undefined;
    } catch (err) {
      return err;
    }
  }

  it('reads a safe-range INTEGER (Number.MAX_SAFE_INTEGER) as a plain number', () => {
    const read = selectBig('9007199254740991');
    expect(read()).toEqual({ big: 9007199254740991 });
  });

  it('throws RangeError/ERR_OUT_OF_RANGE for MAX_SAFE_INTEGER + 1 (2^53)', () => {
    const err = caught(selectBig('9007199254740992'));
    expect(err).toBeInstanceOf(RangeError);
    expect((err as CodedError).code).toBe('ERR_OUT_OF_RANGE');
  });

  it('throws RangeError/ERR_OUT_OF_RANGE for a clearly out-of-range INT64 (no silent truncation)', () => {
    const err = caught(selectBig('9223372036854775807'));
    expect(err).toBeInstanceOf(RangeError);
    expect((err as CodedError).code).toBe('ERR_OUT_OF_RANGE');
  });

  it('mirrors the negative boundary: -MAX_SAFE reads, below it throws', () => {
    expect(selectBig('-9007199254740991')()).toEqual({ big: -9007199254740991 });

    const err = caught(selectBig('-9007199254740993'));
    expect(err).toBeInstanceOf(RangeError);
    expect((err as CodedError).code).toBe('ERR_OUT_OF_RANGE');
  });

  it('also guards array-shaped rows after setReturnArrays(true)', () => {
    const local = new DatabaseSync(':memory:');
    db = local;
    local.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, big INTEGER NOT NULL);');
    local.exec('INSERT INTO t (id, big) VALUES (1, 9223372036854775807);');
    const stmt = local.prepare('SELECT big FROM t WHERE id = ?');
    stmt.setReturnArrays(true);

    const err = caught(() => stmt.get(1));
    expect(err).toBeInstanceOf(RangeError);
    expect((err as CodedError).code).toBe('ERR_OUT_OF_RANGE');
  });
});
