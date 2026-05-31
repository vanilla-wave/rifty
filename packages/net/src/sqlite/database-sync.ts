/**
 * `node:sqlite` `DatabaseSync`-compatible facade over the sql.js WASM engine
 * (ADR-0065). This is the synchronous surface opencode's boot path constructs
 * at Effect layer-build time (Spike C): `new DatabaseSync(filename, {open})`,
 * `db.exec(sql)` for the migration DDL + PRAGMAs, and `db.close()`.
 *
 * The engine bring-up is async (WASM), but the `DatabaseSync` surface is fully
 * synchronous — see {@link ./engine.ts}. The bridge requires
 * `initSqliteEngine()` to have RESOLVED before any `DatabaseSync` is
 * constructed; the constructor calls the synchronous `getSqliteEngine()`, which
 * throws a clear "engine not initialized" error otherwise (no silent stub).
 *
 * Scope of THIS module: the constructor, `open`, `exec`, `close`, and `prepare`
 * (the last returning a {@link StatementSync} for the query path). The remaining
 * members of Node's `DatabaseSync` prototype (`location`, `function`,
 * `aggregate`, `createSession`, `applyChangeset`, `enableLoadExtension`,
 * `loadExtension`) are NOT yet backed — when added they throw a directed
 * `NotImplementedError` with a `docs/compat/sqlite.md` entry, never a faked
 * value (ADR-0065 D4, no silent stubs). They land in follow-up tasks as
 * opencode's boot path needs each one.
 */
import type { Database } from 'sql.js';
import { getSqliteEngine } from './engine.ts';
import { StatementSync } from './statement-sync.ts';

/**
 * Options accepted by Node's `DatabaseSync` constructor. Only the members
 * opencode's boot path passes are modelled with behaviour; the rest are accepted
 * (so the constructor does not reject a real opencode call) and otherwise inert
 * for the first cut.
 *
 * - `open` (default `true`): open the database immediately. `open: false` defers
 *   opening; `exec` before {@link DatabaseSync.open} then throws the Node-shaped
 *   `database is not open` error.
 * - `enableForeignKeyConstraints` (default `true` in Node): issues
 *   `PRAGMA foreign_keys = ON|OFF` on open. sql.js honours `PRAGMA foreign_keys`.
 * - `readOnly` / `allowExtension` / `enableDoubleQuotedStringLiterals` /
 *   `timeout`: accepted but inert in the first cut (see `docs/compat/sqlite.md`).
 *   In particular DQS cannot be toggled at runtime in the prebuilt sql.js WASM,
 *   so `enableDoubleQuotedStringLiterals` is a documented no-op.
 */
export interface DatabaseSyncOptions {
  readonly open?: boolean;
  readonly enableForeignKeyConstraints?: boolean;
  readonly readOnly?: boolean;
  readonly allowExtension?: boolean;
  readonly enableDoubleQuotedStringLiterals?: boolean;
  readonly timeout?: number;
}

/**
 * Build the Node-shaped "database is not open" error. Node throws a plain
 * `Error` whose `.code` is `'ERR_INVALID_STATE'` and whose message is
 * `database is not open` for `exec`/`close`/etc. on a not-open handle; we mirror
 * that so consumers branching on `err.code` behave identically.
 */
function notOpenError(): Error {
  const err = new Error('database is not open') as Error & { code: string };
  err.code = 'ERR_INVALID_STATE';
  return err;
}

/**
 * Synchronous `node:sqlite` `DatabaseSync` shim backed by sql.js (ADR-0065,
 * in-memory first cut). Construction, {@link exec}, and {@link close} are the
 * implemented surface.
 *
 * The `filename` is accepted for API parity but NOT used to back persistence in
 * the first cut: every database is sql.js in-memory regardless of the path
 * (`:memory:`, a file path, anything). Cross-reload durability via OPFS is the
 * deferred follow-up (ADR-0065 D2 / Q-2026-05-31-301); for the boot path
 * opencode uses `OPENCODE_DB=:memory:`, which this matches exactly.
 */
export class DatabaseSync {
  /** The path passed to the constructor — kept for parity; not used for I/O. */
  readonly #filename: string;

  /** The constraints option, applied as `PRAGMA foreign_keys` on open. */
  readonly #enableForeignKeyConstraints: boolean;

  /** The live sql.js database, or `undefined` when not open (closed / `open:false`). */
  #db: Database | undefined;

  /**
   * @param filename - Database path. `:memory:` (or any path, in the first cut)
   *   maps to an sql.js in-memory database.
   * @param options - See {@link DatabaseSyncOptions}. Defaults match Node:
   *   `open: true`, `enableForeignKeyConstraints: true`.
   * @throws {Error} If the sql.js engine has not been brought up yet — call (and
   *   await) `initSqliteEngine()` before constructing. This is the synchronous
   *   half of the async-bring-up bridge (ADR-0065 D1).
   */
  constructor(filename: string, options?: DatabaseSyncOptions) {
    this.#filename = filename;
    this.#enableForeignKeyConstraints = options?.enableForeignKeyConstraints ?? true;
    if (options?.open ?? true) {
      this.open();
    }
  }

  /**
   * Open the database. Constructs the sql.js in-memory database and applies the
   * `PRAGMA foreign_keys` setting from the constructor options.
   *
   * Calling `open()` on an already-open database throws the Node-shaped
   * `ERR_INVALID_STATE` error (`database is already open`), matching Node.
   */
  open(): void {
    if (this.#db !== undefined) {
      const err = new Error('database is already open') as Error & { code: string };
      err.code = 'ERR_INVALID_STATE';
      throw err;
    }
    const engine = getSqliteEngine();
    this.#db = new engine.Database();
    // sql.js honours `PRAGMA foreign_keys`; apply the constructor option so the
    // open handle reflects the requested constraint enforcement, as Node does.
    this.#db.run(`PRAGMA foreign_keys = ${this.#enableForeignKeyConstraints ? 'ON' : 'OFF'};`);
  }

  /**
   * Execute one or more SQL statements, ignoring any rows they return. Mirrors
   * Node's `DatabaseSync.prototype.exec`: it accepts a string that may contain
   * MULTIPLE `;`-separated statements (the migration path issues `CREATE TABLE`
   * + `INSERT` in one call) and returns `undefined`.
   *
   * `PRAGMA journal_mode = WAL` and other PRAGMAs run through sql.js as-is; sql.js
   * is in-memory so WAL is moot, but the statement succeeds (it does not throw),
   * which is all opencode's boot path requires (ADR-0065 D3).
   *
   * @param sql - One or more `;`-separated SQL statements.
   * @throws {Error} `ERR_INVALID_STATE` ("database is not open") if the database
   *   is closed or was constructed with `open: false` and not yet opened.
   */
  exec(sql: string): undefined {
    if (this.#db === undefined) throw notOpenError();
    this.#db.run(sql);
    return undefined;
  }

  /**
   * Close the database and free its memory. Idempotency note: Node throws
   * `ERR_INVALID_STATE` ("database is not open") on a double-close, so this does
   * too (it does NOT silently no-op a second close).
   *
   * @throws {Error} `ERR_INVALID_STATE` if the database is already closed / not
   *   open.
   */
  close(): void {
    if (this.#db === undefined) throw notOpenError();
    this.#db.close();
    this.#db = undefined;
  }

  /**
   * Prepare a statement and return a {@link StatementSync} bound to it. Mirrors
   * Node's `DatabaseSync.prototype.prepare(sql)`: it compiles the SQL once and
   * hands back a reusable statement whose `all`/`get`/`run` accept positional
   * params. This is the entry point the effect-drizzle session calls on every
   * query (`native.prepare(q).all(...params)`).
   *
   * @param sql - A single SQL statement, optionally with `?` placeholders.
   * @returns A {@link StatementSync} wrapping the compiled sql.js statement.
   * @throws {Error} `ERR_INVALID_STATE` ("database is not open") if the database
   *   is closed or was constructed with `open: false` and not yet opened.
   */
  prepare(sql: string): StatementSync {
    if (this.#db === undefined) throw notOpenError();
    return new StatementSync(this.#db, this.#db.prepare(sql));
  }
}
