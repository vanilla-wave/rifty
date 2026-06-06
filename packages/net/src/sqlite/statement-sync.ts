/**
 * `node:sqlite` `StatementSync`-compatible facade over a sql.js prepared
 * `Statement` (ADR-0065). The query surface the effect-drizzle session inside
 * opencode calls on EVERY query — `native.prepare(q).all(...params)` with
 * positional `?` placeholders, plus the `setReturnArrays`/`setReadBigInts`
 * row-shape toggles.
 *
 * Result-producing methods (`all`/`get`/`iterate`) accept EITHER positional `?`
 * params (`get('a', 1)`) OR a single named-parameter object (`get({ ':id': 'x' })`,
 * bare `get({ id: 'x' })` once {@link setAllowBareNamedParameters}(true)).
 *
 * Two members throw a directed {@link NotImplementedError} rather than fake a
 * value (no-silent-stubs, ADR-0065 D4; both ❌ in `docs/compat/sqlite.md`):
 * `setReadBigInts(true)` (prebuilt sql.js WASM has no bigint read mode) and
 * `columns()` (WASM built without `SQLITE_ENABLE_COLUMN_METADATA`). See each
 * member's doc for detail.
 *
 * `expandedSQL`/`sourceSQL` are not yet backed; they land when opencode needs them.
 */
import { NotImplementedError } from '@riftydev/io';
import type { BindParams, Database, ParamsObject, SqlValue, Statement } from 'sql.js';

/**
 * A single result row, object-keyed (Node default) or a bare value tuple (after
 * `setReturnArrays(true)`). `SqlValue` is sql.js's `number | string | Uint8Array
 * | null` union.
 */
type ResultRow = Record<string, SqlValue> | SqlValue[];

/**
 * Argument shape the result-producing methods accept, mirroring Node's
 * `StatementSync`: zero-or-more POSITIONAL values (for `?`), or a SINGLE
 * named-parameter object (`:name`/`@name`/`$name`, bare keys allowed once
 * {@link StatementSync.setAllowBareNamedParameters}(true)). A lone object first
 * arg is named params; anything else (incl. a `Uint8Array` blob, a value not a
 * params object) is positional.
 */
type StatementParam = SqlValue | ParamsObject;

/** Node's `StatementSync.prototype.run` return shape. */
interface RunResult {
  readonly lastInsertRowid: number;
  readonly changes: number;
}

/**
 * Whether `value` is a named-parameter object vs a positional `SqlValue`. `null`
 * is a SQL value and `Uint8Array` is a BLOB value — both read as positional, not
 * params objects.
 */
function isNamedParams(value: StatementParam): value is ParamsObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

/** Sigils SQLite accepts for named parameters; a key without one is "bare". */
const NAMED_PARAM_SIGILS = [':', '@', '$'] as const;

/**
 * Guard an INTEGER read against the precision ceiling Node enforces under the
 * default `setReadBigInts(false)` (ADR-0065, finding #2). Node's `node:sqlite`
 * throws `RangeError`/`ERR_OUT_OF_RANGE` when an INTEGER's magnitude exceeds
 * `Number.MAX_SAFE_INTEGER` (verified vs Node v24: first refused value is `2^53`),
 * rather than return a truncated float.
 *
 * The prebuilt sql.js WASM stores INTEGERs as JS `number` with no per-column
 * storage-type accessor, so we detect overflow from the value itself: an
 * integer-valued non-safe `number` is one sql.js has ALREADY truncated, and
 * returning it would be a silent precision lie (no-silent-stubs, ADR-0065 D4).
 * Non-integer reals, strings, blobs, `null` pass through.
 *
 * Caveat (`docs/compat/sqlite.md`): a REAL holding a whole number above `2^53`
 * is indistinguishable from a truncated INTEGER given only the JS number (sql.js
 * has no `sqlite3_column_type`), so it is guarded too — Node would return it.
 * Rare edge; guarding keeps the dangerous case (truncated INTEGER passed as
 * exact) honest. The path that would side-step this is the unsupported
 * `setReadBigInts(true)` (see {@link StatementSync.setReadBigInts}).
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
 * Each result-producing call binds params, steps the cursor, then resets the
 * statement so it stays reusable — matching Node's reusable `StatementSync`.
 */
export class StatementSync {
  /** Owning sql.js database — for `last_insert_rowid()` / `getRowsModified()`. */
  readonly #db: Database;

  readonly #stmt: Statement;

  /** `true`: rows are bare value tuples; `false` (default): object-keyed. */
  #returnArrays = false;

  /**
   * `true` (default, matching Node): a named-param object may use BARE keys
   * (`{ id }`), prefixed with `:` for sql.js. `false`: bare keys throw the
   * Node-shaped `ERR_INVALID_STATE`.
   */
  #allowBareNamedParameters = true;

  constructor(db: Database, stmt: Statement) {
    this.#db = db;
    this.#stmt = stmt;
  }

  /**
   * Normalise the args Node's `StatementSync` methods accept into sql.js's
   * `BindParams`. POSITIONAL (`all('a', 1)` → `['a', 1]`) or NAMED (a lone object
   * first arg). An empty list binds `null` (sql.js leaves params unbound),
   * matching Node's no-arg form.
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
   * Translate a named-param object into the sigil-prefixed shape sql.js binds by
   * name. Sigil keys pass through; bare keys are prefixed with `:` when allowed,
   * else throw the Node-shaped `ERR_INVALID_STATE`.
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
   * Execute and return ALL rows. Mirrors Node's `all(...params)`: object-keyed by
   * default, value tuples after {@link setReturnArrays}(true), `[]` for no rows.
   * The exact call effect-drizzle makes on every read.
   *
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns Rows; `[]` when none match.
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
   * Execute and return the FIRST row, or `undefined` for no rows. Mirrors Node's
   * `get(...params)`.
   *
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns The first row, or `undefined`.
   */
  get(...params: StatementParam[]): ResultRow | undefined {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    const row = this.#stmt.step() ? this.#readRow() : undefined;
    this.#stmt.reset();
    return row;
  }

  /**
   * Lazily iterate result rows in cursor order. Mirrors Node's
   * `iterate(...params)`. A generator so iteration is genuinely lazy — a row is
   * read from sql.js only when the consumer pulls it, matching Node's
   * step-on-demand iterator. Row shape as `all`.
   *
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns An iterator over rows in cursor order.
   */
  *iterate(...params: StatementParam[]): IterableIterator<ResultRow> {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    try {
      while (this.#stmt.step()) {
        yield this.#readRow();
      }
    } finally {
      // Reset even on early abandon (`break`/`return` runs `finally`) to keep the
      // prepared statement reusable.
      this.#stmt.reset();
    }
  }

  /**
   * Execute a non-row-returning statement (INSERT/UPDATE/DELETE). Mirrors Node's
   * `run(...params)`, returning `{ lastInsertRowid, changes }` from
   * `last_insert_rowid()` and `getRowsModified()`.
   *
   * @param params - Positional `?` values, or a single named-parameter object.
   * @returns `{ lastInsertRowid, changes }`.
   */
  run(...params: StatementParam[]): RunResult {
    this.#stmt.reset();
    this.#stmt.bind(this.#bindParams(params));
    // Step to completion, discarding rows: a single step suffices for DML, loop
    // defensively in case the statement yields rows.
    while (this.#stmt.step()) {}
    this.#stmt.reset();
    const changes = this.#db.getRowsModified();
    const rowidResult = this.#db.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = Number(rowidResult[0]?.values[0]?.[0] ?? 0);
    return { lastInsertRowid, changes };
  }

  /**
   * Set whether result rows are bare value tuples (`true`) or object-keyed
   * (`false`, default). Mirrors Node's `setReturnArrays`. Effect's session flips
   * this to read rows positionally.
   *
   * @param returnArrays - `true` for array rows, `false` for object rows.
   */
  setReturnArrays(returnArrays: boolean): void {
    this.#returnArrays = returnArrays;
  }

  /**
   * Set whether INTEGER columns read as `BigInt` (`true`) or plain `number`
   * (`false`, default — also effect's SafeIntegers-default). Mirrors Node's
   * `setReadBigInts`.
   *
   * The `true` path is NOT supported: the prebuilt sql.js WASM stores INTEGERs as
   * JS `number` with no bigint read mode, and coercing to `BigInt` would silently
   * lie above `Number.MAX_SAFE_INTEGER` (already lossy before the cast), so it
   * throws (ADR-0065 D4, no-silent-stubs; ❌ in `docs/compat/sqlite.md`).
   *
   * The `false` path is NOT silent on overflow either: an INTEGER past
   * `Number.MAX_SAFE_INTEGER` throws `RangeError`/`ERR_OUT_OF_RANGE` on read (see
   * {@link guardSafeInteger}), matching Node v24 (ADR-0065 finding #2).
   *
   * @param readBigInts - `true` to request BigInt reads (unsupported).
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
   * Set whether a named-param object may use BARE keys (`{ id }`, prefixed with
   * `:` for sql.js) or only sigil-prefixed keys. Mirrors Node's
   * `setAllowBareNamedParameters`. Defaults `true` (as Node); `false` makes bare
   * keys throw `ERR_INVALID_STATE`.
   *
   * @param allow - `true` to accept bare keys, `false` to reject.
   */
  setAllowBareNamedParameters(allow: boolean): void {
    this.#allowBareNamedParameters = allow;
  }

  /**
   * Return per-column metadata. NOT supported: Node returns the full shape
   * `{ column, database, name, table, type }`, which needs SQLite's
   * `SQLITE_ENABLE_COLUMN_METADATA` build (the `sqlite3_column_table_name` etc.
   * exports). The prebuilt sql.js WASM is compiled WITHOUT it (only
   * `sqlite3_column_name`), so a partial shape would be a silent stub — this
   * throws (ADR-0065 D4, ❌ in `docs/compat/sqlite.md`). Not on opencode's path.
   *
   * @throws {NotImplementedError} Always — engine lacks column metadata.
   */
  columns(): never {
    throw new NotImplementedError(
      'sqlite.StatementSync.columns',
      'the prebuilt sql.js WASM is built without SQLITE_ENABLE_COLUMN_METADATA, ' +
        "so the column's table/database/declared-type are unavailable (ADR-0065)",
    );
  }

  /**
   * Read the current row in the configured shape (object-keyed by default, value
   * tuple after {@link setReturnArrays}(true)). INTEGERs come back as plain
   * `number` (sql.js's only integer rep; BigInt path unsupported, see
   * {@link setReadBigInts}).
   *
   * Every value goes through {@link guardSafeInteger} so an INTEGER sql.js has
   * already truncated past `Number.MAX_SAFE_INTEGER` throws rather than returning
   * a silent precision lie (ADR-0065 finding #2).
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
