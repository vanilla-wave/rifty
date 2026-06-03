/**
 * `node:sqlite` `StatementSync`-compatible facade over a sql.js prepared
 * `Statement` (ADR-0065). This is the query surface the effect-drizzle session
 * inside opencode calls on EVERY query — literally `native.prepare(q).all(...
 * params)` with positional `?` placeholders, plus the row-shape toggles
 * `setReturnArrays` and `setReadBigInts`.
 *
 * Scope of THIS module: the full per-query surface the contract owes — `all`,
 * `get`, `run`, `iterate`, `setReturnArrays`, `setReadBigInts`,
 * `setAllowBareNamedParameters`, and (deliberately) `columns`. Each result-
 * producing method (`all`/`get`/`iterate`) accepts EITHER positional `?` params
 * (`get('a', 1)`) OR a single named-parameter object (`get({ ':id': 'x' })`,
 * and bare `get({ id: 'x' })` once {@link setAllowBareNamedParameters}(true)).
 *
 * Two members throw a directed {@link NotImplementedError} (with a
 * `docs/compat/sqlite.md` entry) rather than fake a value — the no-silent-stubs
 * rule (ADR-0065 D4):
 *
 *   - `setReadBigInts(true)` — the prebuilt sql.js WASM has NO bigint read mode;
 *     it stores every INTEGER in a JS `number`. Coercing those to `BigInt` would
 *     be a silent precision lie above `Number.MAX_SAFE_INTEGER` (the number is
 *     already lossy before the cast). The `false` path (the default, and
 *     effect's SafeIntegers-default state) is a plain-`number` read, but it is
 *     NOT silent on overflow: an INTEGER past `Number.MAX_SAFE_INTEGER` throws
 *     Node's `RangeError` / `ERR_OUT_OF_RANGE` rather than a truncated float
 *     (ADR-0065 finding #2; see `guardSafeInteger`).
 *   - `columns()` — Node returns full per-column metadata
 *     (`{ column, database, name, table, type }`), which needs SQLite's
 *     `SQLITE_ENABLE_COLUMN_METADATA` build (the `sqlite3_column_table_name` /
 *     `_database_name` / `_origin_name` / `_decltype` exports). The prebuilt
 *     sql.js WASM is compiled WITHOUT that flag (only `sqlite3_column_name` is
 *     exposed), so a faithful shape is unavailable. A partial shape would be a
 *     silent stub, so this throws.
 *
 * The remaining `StatementSync` members (`expandedSQL`, `sourceSQL`) are not yet
 * backed; they land in follow-up tasks as opencode's path needs them.
 */
import { NotImplementedError } from '@riftydev/io';
import type { BindParams, Database, ParamsObject, SqlValue, Statement } from 'sql.js';

/**
 * A single result row, either object-keyed (the Node default) or a bare value
 * tuple (after `setReturnArrays(true)`). `SqlValue` is sql.js's value union
 * (`number | string | Uint8Array | null`).
 */
type ResultRow = Record<string, SqlValue> | SqlValue[];

/**
 * The argument shape the result-producing methods accept, mirroring Node's
 * `StatementSync`: either zero-or-more POSITIONAL values (for `?` placeholders)
 * or a SINGLE named-parameter object (for `:name` / `@name` / `$name`
 * placeholders, with bare keys allowed once {@link StatementSync.
 * setAllowBareNamedParameters}(true)). A lone object first argument is treated
 * as named params; anything else (including a `Uint8Array` blob, which is a
 * value, not a params object) is positional.
 */
type StatementParam = SqlValue | ParamsObject;

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
 * Whether `value` is a named-parameter object (a plain object), as opposed to a
 * positional `SqlValue`. A lone object first argument means "named params" in
 * Node's `StatementSync`. `null` is a SQL value, not a params object; a
 * `Uint8Array` is a BLOB value, not a params object — both must read as
 * positional. Anything else that is a non-array, non-typed-array object is a
 * named-params object.
 */
function isNamedParams(value: StatementParam): value is ParamsObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

/**
 * The sigils SQLite accepts for named parameters: `:name`, `@name`, `$name`.
 * Used to decide whether a key in a named-params object is already prefixed (so
 * it binds directly) or bare (so it needs the `setAllowBareNamedParameters`
 * gate before being prefixed with `:` for sql.js).
 */
const NAMED_PARAM_SIGILS = [':', '@', '$'] as const;

/**
 * Guard a value read out of an INTEGER column against the precision ceiling Node
 * enforces under the default `setReadBigInts(false)` state (ADR-0065, finding
 * #2). Node's real `node:sqlite` throws a `RangeError` with code
 * `ERR_OUT_OF_RANGE` when an INTEGER value's magnitude exceeds
 * `Number.MAX_SAFE_INTEGER` (verified head-to-head against Node v24: the first
 * value it refuses is `2^53` = `Number.MAX_SAFE_INTEGER + 1`), rather than hand
 * back a truncated float.
 *
 * The prebuilt sql.js WASM stores every INTEGER as a JS `number` and exposes no
 * per-column storage-type accessor on its public API, so we detect the overflow
 * from the returned value itself: an integer-valued `number` that is not a
 * SAFE integer (`Number.isInteger(v) && !Number.isSafeInteger(v)`) is a value
 * sql.js has ALREADY truncated. Returning it would be a silent precision lie, so
 * this throws the Node-shaped `RangeError` instead (the no-silent-stubs rule,
 * ADR-0065 D4). Non-integer reals, strings, blobs, and `null` pass through
 * untouched — only integer-valued numbers past the safe range are guarded, which
 * is exactly Node's INTEGER-column threshold.
 *
 * Caveat (documented in `docs/compat/sqlite.md`): a REAL column holding a
 * whole-number value above `2^53` is indistinguishable from a truncated INTEGER
 * given only the JS number sql.js returns (the public sql.js API has no
 * `sqlite3_column_type`), so it is guarded too. Node would return that REAL
 * without throwing. This is a rare, exotic edge; guarding it keeps the common
 * and dangerous case (a truncated INTEGER presented as exact) honest rather than
 * silently lossy. The BigInt read path that would side-step this entirely is the
 * unsupported `setReadBigInts(true)` (see {@link StatementSync.setReadBigInts}).
 */
function guardSafeInteger(value: SqlValue): SqlValue {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    const err = new RangeError(
      `Value is too large to be represented as a JavaScript number: ${value}`,
    ) as RangeError & { code: string };
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
  }
  return value;
}

/**
 * Synchronous `node:sqlite` `StatementSync` shim backed by a sql.js prepared
 * `Statement` (ADR-0065). Constructed only by {@link DatabaseSync.prepare}; the
 * caller owns the underlying `Database` lifetime.
 *
 * Each result-producing call (`all` / `get` / `iterate`) binds the given params,
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

  /**
   * When `true` (the default, matching Node), a named-parameter object may use
   * BARE keys (`{ id }`) that this shim prefixes with `:` for sql.js. When
   * `false`, bare keys throw the Node-shaped `ERR_INVALID_STATE`.
   */
  #allowBareNamedParameters = true;

  /**
   * @param db - The owning sql.js database (for run-result metadata).
   * @param stmt - The prepared sql.js statement to wrap.
   */
  constructor(db: Database, stmt: Statement) {
    this.#db = db;
    this.#stmt = stmt;
  }

  /**
   * Normalise the arguments Node's `StatementSync` methods accept into the
   * `BindParams` sql.js's `bind` wants. Two forms:
   *
   *   - POSITIONAL: `all('a', 1)` → `['a', 1]` for the statement's `?`
   *     placeholders. An empty argument list binds nothing (`null` — sql.js
   *     leaves params unbound), matching Node's no-arg form.
   *   - NAMED: a single object first argument (`get({ ':id': 'x' })`) →
   *     `{ ':id': 'x' }`. Keys already carrying a `:`/`@`/`$` sigil pass through;
   *     BARE keys are prefixed with `:` only when
   *     {@link setAllowBareNamedParameters} is on, otherwise this throws the
   *     Node-shaped `ERR_INVALID_STATE` (Node rejects bare keys by default-off).
   */
  #bindParams(params: readonly StatementParam[]): BindParams {
    if (params.length === 0) return null;
    const first = params[0] as StatementParam;
    if (params.length === 1 && isNamedParams(first)) {
      return this.#normaliseNamedParams(first);
    }
    return params as SqlValue[];
  }

  /**
   * Translate a named-parameter object into the sigil-prefixed shape sql.js
   * binds by name. Sigil-prefixed keys pass through unchanged; bare keys are
   * prefixed with `:` when bare keys are allowed, else this throws the
   * Node-shaped `ERR_INVALID_STATE` (mirroring Node's bare-key rejection when
   * `setAllowBareNamedParameters(false)`).
   */
  #normaliseNamedParams(obj: ParamsObject): ParamsObject {
    const out: ParamsObject = {};
    for (const [key, value] of Object.entries(obj)) {
      if ((NAMED_PARAM_SIGILS as readonly string[]).includes(key[0] ?? '')) {
        out[key] = value;
      } else if (this.#allowBareNamedParameters) {
        out[`:${key}`] = value;
      } else {
        const err = new Error(`Unknown named parameter '${key}'`) as Error & { code: string };
        err.code = 'ERR_INVALID_STATE';
        throw err;
      }
    }
    return out;
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
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns An array of rows; `[]` when no rows match.
   */
  all(...params: StatementParam[]): ResultRow[] {
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
   * Execute the statement with the given params and return the FIRST result row,
   * or `undefined` when no rows match. Mirrors Node's
   * `StatementSync.prototype.get(...params)`.
   *
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns The first row, or `undefined` if there are none.
   */
  get(...params: StatementParam[]): ResultRow | undefined {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    const row = this.#stmt.step() ? this.#readRow() : undefined;
    this.#stmt.reset();
    return row;
  }

  /**
   * Lazily iterate the result rows. Mirrors Node's
   * `StatementSync.prototype.iterate(...params)`: it binds the params, then
   * yields one row per `next()` in cursor order (the SQL's `ORDER BY` order),
   * resetting the statement once the cursor is exhausted so the prepared
   * statement stays reusable. Rows take the configured shape (object-keyed by
   * default, tuples after {@link setReturnArrays}(true)), exactly as `all`.
   *
   * Implemented as a generator so the iteration is genuinely lazy — a row is
   * read from sql.js only when the consumer pulls it — matching Node, where
   * `iterate` returns an iterator that steps the underlying statement on demand.
   *
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns An iterator over the result rows, in cursor order.
   */
  *iterate(...params: StatementParam[]): IterableIterator<ResultRow> {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    try {
      while (this.#stmt.step()) {
        yield this.#readRow();
      }
    } finally {
      // Reset even if the consumer abandons the iterator early (`break`/`return`
      // runs the generator's `finally`), so the prepared statement is reusable.
      this.#stmt.reset();
    }
  }

  /**
   * Execute a non-row-returning statement (INSERT/UPDATE/DELETE) with the given
   * params. Mirrors Node's `StatementSync.prototype.run(...params)`, returning
   * `{ lastInsertRowid, changes }` read from the database's
   * `last_insert_rowid()` and `getRowsModified()` after the step.
   *
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns `{ lastInsertRowid, changes }` for the executed statement.
   */
  run(...params: StatementParam[]): RunResult {
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
   * The `true` path is NOT supported by the prebuilt sql.js WASM engine: it
   * stores every INTEGER in a JS `number`, so there is no bigint read mode.
   * Coercing those numbers to `BigInt` would silently lie about values above
   * `Number.MAX_SAFE_INTEGER` (the number is already lossy before the cast), so
   * `setReadBigInts(true)` throws a directed {@link NotImplementedError} rather
   * than fake a value (ADR-0065 D4, no silent stubs; registered ❌ in
   * `docs/compat/sqlite.md`).
   *
   * The `false` path (the default) does not change the row-read mechanism, but it
   * is NOT silent on overflow: an INTEGER value past `Number.MAX_SAFE_INTEGER`
   * throws Node's `RangeError` / `ERR_OUT_OF_RANGE` from the read methods (see
   * {@link guardSafeInteger}), matching Node v24 exactly rather than returning a
   * truncated float (ADR-0065 finding #2).
   *
   * @param readBigInts - `true` to request BigInt INTEGER reads (unsupported).
   * @throws {NotImplementedError} When `readBigInts` is `true`.
   */
  setReadBigInts(readBigInts: boolean): void {
    if (readBigInts) {
      throw new NotImplementedError(
        'sqlite.Statement.setReadBigInts(true)',
        'the prebuilt sql.js WASM stores INTEGER columns as JS numbers and has ' +
          'no bigint read mode; faking BigInt would lose precision above ' +
          'Number.MAX_SAFE_INTEGER (ADR-0065)',
      );
    }
  }

  /**
   * Set whether a named-parameter object may use BARE keys (`{ id }`, which this
   * shim prefixes with `:` for sql.js) or only sigil-prefixed keys
   * (`{ ':id' }`). Mirrors Node's `StatementSync.prototype.
   * setAllowBareNamedParameters`. Defaults to `true` (as Node does); set to
   * `false` to make bare keys throw `ERR_INVALID_STATE`.
   *
   * @param allow - `true` to accept bare keys, `false` to reject them.
   */
  setAllowBareNamedParameters(allow: boolean): void {
    this.#allowBareNamedParameters = allow;
  }

  /**
   * Return per-column metadata for the prepared statement. NOT supported by the
   * prebuilt sql.js WASM engine: Node returns the full shape
   * `{ column, database, name, table, type }`, which requires SQLite's
   * `SQLITE_ENABLE_COLUMN_METADATA` build (the `sqlite3_column_table_name` /
   * `_database_name` / `_origin_name` / `_decltype` exports). The prebuilt sql.js
   * WASM is compiled WITHOUT that flag — it exposes only `sqlite3_column_name`,
   * so the table/database/decltype fields are unavailable. Returning a partial
   * shape would be a silent stub, so this throws a directed
   * {@link NotImplementedError} (registered ❌ in `docs/compat/sqlite.md`,
   * ADR-0065 D4). It is not on opencode's boot/query path.
   *
   * @throws {NotImplementedError} Always — the engine lacks column metadata.
   */
  columns(): never {
    throw new NotImplementedError(
      'sqlite.StatementSync.columns',
      'the prebuilt sql.js WASM is built without SQLITE_ENABLE_COLUMN_METADATA, ' +
        "so the column's table/database/declared-type are unavailable (ADR-0065)",
    );
  }

  /**
   * Read the current row from the stepped statement in the configured shape
   * (object-keyed by default, or a bare value tuple after
   * {@link setReturnArrays}(true)). INTEGER columns come back as plain `number`s
   * (sql.js's only integer representation); the BigInt path is unsupported (see
   * {@link setReadBigInts}).
   *
   * Every value is run through {@link guardSafeInteger} so an INTEGER that sql.js
   * has already truncated past `Number.MAX_SAFE_INTEGER` throws Node's
   * `RangeError` / `ERR_OUT_OF_RANGE` rather than being returned as a silent
   * precision lie (ADR-0065 finding #2, no-silent-stubs).
   */
  #readRow(): ResultRow {
    if (this.#returnArrays) {
      return this.#stmt.get().map(guardSafeInteger);
    }
    const obj = this.#stmt.getAsObject();
    for (const key of Object.keys(obj)) {
      obj[key] = guardSafeInteger(obj[key] as SqlValue);
    }
    return obj;
  }
}
