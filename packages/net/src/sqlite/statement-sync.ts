/**
 * `node:sqlite` `StatementSync`-compatible facade over a sql.js prepared
 * `Statement` (ADR-0065). This is the query surface the effect-drizzle session
 * inside opencode calls on EVERY query — literally `native.prepare(q).all(...
 * params)` with positional `?` placeholders, plus the row-shape toggles
 * `setReturnArrays` and `setReadBigInts`.
 *
 * Scope of THIS module (the prepare/all/run/toggles task): `all`, `run`, `get`,
 * `setReturnArrays`, `setReadBigInts`. The remaining members of Node's
 * `StatementSync` prototype (`iterate`, `expandedSQL`, `sourceSQL`,
 * `setAllowBareNamedParameters`, `columns`) are NOT yet backed — they throw a
 * directed {@link NotImplementedError} with a `docs/compat/sqlite.md` entry,
 * never a faked value (ADR-0065 D4, no silent stubs). They land in follow-up
 * tasks as opencode's boot path needs each one.
 *
 * Row-type note (`setReadBigInts`): Node reads INTEGER columns as `BigInt` when
 * `setReadBigInts(true)` and as plain `number` otherwise (the default, which is
 * also effect's SafeIntegers-default state). sql.js returns INTEGER columns as
 * plain `number`s, so the default path is a direct pass-through; the `true` path
 * coerces those numbers to `BigInt` to match Node. (sql.js stores integers in a
 * JS `number`, so values beyond `Number.MAX_SAFE_INTEGER` are already lossy in
 * sql.js — a documented first-cut precision gap in `docs/compat/sqlite.md`, NOT
 * something this surface can paper over.)
 */
import { NotImplementedError } from '@rifty/io';
import type { BindParams, Database, SqlValue, Statement } from 'sql.js';

/**
 * A single result row, either object-keyed (the Node default) or a bare value
 * tuple (after `setReturnArrays(true)`). `SqlValue` is sql.js's value union
 * (`number | string | Uint8Array | null`); when `setReadBigInts(true)` is set we
 * also yield `bigint` for INTEGER columns, so the value type widens accordingly.
 */
type ResultValue = SqlValue | bigint;
type ResultRow = Record<string, ResultValue> | ResultValue[];

/**
 * The shape Node's `StatementSync.prototype.run` returns: the rowid of the last
 * inserted row and the number of rows changed by the statement. Mirrored exactly
 * so consumers reading `.lastInsertRowid` / `.changes` behave identically.
 */
interface RunResult {
  readonly lastInsertRowid: number;
  readonly changes: number;
}

/**
 * Coerce one sql.js cell value to the shape Node would return for the current
 * `readBigInts` setting. sql.js hands back `number` for INTEGER columns; when
 * `readBigInts` is on, Node returns `BigInt`, so we convert integral numbers
 * to `BigInt`. Non-integral numbers, strings, blobs and `null` are returned
 * unchanged (Node never returns `BigInt` for `REAL`/`TEXT`/`BLOB`/`NULL`).
 */
function coerceValue(value: SqlValue, readBigInts: boolean): ResultValue {
  if (readBigInts && typeof value === 'number' && Number.isInteger(value)) {
    return BigInt(value);
  }
  return value;
}

/**
 * Synchronous `node:sqlite` `StatementSync` shim backed by a sql.js prepared
 * `Statement` (ADR-0065). Constructed only by {@link DatabaseSync.prepare}; the
 * caller owns the underlying `Database` lifetime.
 *
 * Each result-producing call (`all` / `get`) binds the given positional params,
 * steps the cursor to exhaustion (or once), then resets the statement so the
 * same prepared statement is reusable across calls — matching Node's reusable
 * `StatementSync`.
 */
export class StatementSync {
  /** The owning sql.js database — needed for `last_insert_rowid()` / `getRowsModified()`. */
  readonly #db: Database;

  /** The live sql.js prepared statement. */
  readonly #stmt: Statement;

  /** When `true`, rows are bare value tuples; when `false` (default), object-keyed. */
  #returnArrays = false;

  /** When `true`, INTEGER columns are read as `BigInt`; when `false` (default), `number`. */
  #readBigInts = false;

  /**
   * @param db - The owning sql.js database (for run-result metadata).
   * @param stmt - The prepared sql.js statement to wrap.
   */
  constructor(db: Database, stmt: Statement) {
    this.#db = db;
    this.#stmt = stmt;
  }

  /**
   * Normalise the variadic positional params Node's `StatementSync` methods
   * accept (`all('a', 1)`) into the array sql.js `bind` wants (`['a', 1]`). An
   * empty argument list binds nothing (sql.js treats `null`/empty as "leave
   * unbound"), matching Node's no-arg form.
   */
  #bindParams(params: readonly SqlValue[]): BindParams {
    return params.length === 0 ? null : (params as SqlValue[]);
  }

  /**
   * Execute the statement with the given positional params and return ALL result
   * rows. Mirrors Node's `StatementSync.prototype.all(...params)`: object-keyed
   * rows by default, bare value tuples after {@link setReturnArrays}(true), and
   * `[]` when the query matches no rows.
   *
   * This is the exact call the effect-drizzle session makes on every read query
   * (`native.prepare(q).all(...params)`).
   *
   * @param params - Positional values for the statement's `?` placeholders.
   * @returns An array of rows; `[]` when no rows match.
   */
  all(...params: SqlValue[]): ResultRow[] {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    const rows: ResultRow[] = [];
    while (this.#stmt.step()) {
      rows.push(this.#readRow());
    }
    this.#stmt.reset();
    return rows;
  }

  /**
   * Execute the statement with the given positional params and return the FIRST
   * result row, or `undefined` when no rows match. Mirrors Node's
   * `StatementSync.prototype.get(...params)`.
   *
   * @param params - Positional values for the statement's `?` placeholders.
   * @returns The first row, or `undefined` if there are none.
   */
  get(...params: SqlValue[]): ResultRow | undefined {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    const row = this.#stmt.step() ? this.#readRow() : undefined;
    this.#stmt.reset();
    return row;
  }

  /**
   * Execute a non-row-returning statement (INSERT/UPDATE/DELETE) with the given
   * positional params. Mirrors Node's `StatementSync.prototype.run(...params)`,
   * returning `{ lastInsertRowid, changes }` read from the database's
   * `last_insert_rowid()` and `getRowsModified()` after the step.
   *
   * @param params - Positional values for the statement's `?` placeholders.
   * @returns `{ lastInsertRowid, changes }` for the executed statement.
   */
  run(...params: SqlValue[]): RunResult {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    // Step the statement to completion (run ignores any rows). A single step is
    // enough for DML; loop defensively in case the statement yields rows.
    while (this.#stmt.step()) {
      // intentionally discard rows
    }
    this.#stmt.reset();
    const changes = this.#db.getRowsModified();
    const rowidResult = this.#db.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = Number(rowidResult[0]?.values[0]?.[0] ?? 0);
    return { lastInsertRowid, changes };
  }

  /**
   * Set whether result rows are bare value tuples (`true`) or object-keyed
   * (`false`, the default). Mirrors Node's `StatementSync.prototype.
   * setReturnArrays`. Effect's session flips this to read rows positionally.
   *
   * @param returnArrays - `true` for array-shaped rows, `false` for object rows.
   */
  setReturnArrays(returnArrays: boolean): void {
    this.#returnArrays = returnArrays;
  }

  /**
   * Set whether INTEGER columns are read as `BigInt` (`true`) or plain `number`
   * (`false`, the default — also effect's SafeIntegers-default state). Mirrors
   * Node's `StatementSync.prototype.setReadBigInts`.
   *
   * @param readBigInts - `true` to read INTEGER columns as `BigInt`.
   */
  setReadBigInts(readBigInts: boolean): void {
    this.#readBigInts = readBigInts;
  }

  /**
   * Read the current row from the stepped statement in the configured shape
   * (object-keyed or array tuple) with the configured integer type
   * (`number`/`BigInt`).
   */
  #readRow(): ResultRow {
    if (this.#returnArrays) {
      return this.#stmt.get().map((v) => coerceValue(v, this.#readBigInts));
    }
    const obj = this.#stmt.getAsObject();
    const out: Record<string, ResultValue> = {};
    for (const key of Object.keys(obj)) {
      out[key] = coerceValue(obj[key] as SqlValue, this.#readBigInts);
    }
    return out;
  }

  /**
   * Iterate result rows lazily. NOT YET implemented — lands in a follow-up task
   * if opencode's query path needs it. Throws a directed
   * {@link NotImplementedError} (registered in `docs/compat/sqlite.md`) rather
   * than returning a fake iterator (ADR-0065 D4).
   */
  iterate(..._params: SqlValue[]): never {
    throw new NotImplementedError(
      'sqlite.StatementSync.iterate',
      'lazy row iteration lands in a follow-up task (ADR-0065)',
    );
  }
}
