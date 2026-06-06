/**
 * `node:sqlite` `DatabaseSync`-compatible facade over the sql.js WASM engine
 * (ADR-0065). Synchronous surface opencode's boot path constructs at Effect
 * layer-build time (Spike C): construct, `exec` for migration DDL + PRAGMAs,
 * `close`.
 *
 * Engine bring-up is async (WASM) but this surface is fully synchronous — see
 * {@link ./engine.ts}. Requires `initSqliteEngine()` to have RESOLVED before any
 * `DatabaseSync` is constructed; the constructor calls synchronous
 * `getSqliteEngine()`, which throws "engine not initialized" otherwise (no
 * silent stub).
 *
 * Scope: constructor, `open`, `exec`, `close`, `prepare`. Other `DatabaseSync`
 * members (`location`, `function`, `aggregate`, `createSession`,
 * `applyChangeset`, `enableLoadExtension`, `loadExtension`) are not yet backed —
 * when added they throw a directed `NotImplementedError` with a
 * `docs/compat/sqlite.md` entry, never a faked value (ADR-0065 D4).
 */
import type { Database } from 'sql.js';
import { getSqliteEngine } from './engine.ts';
import { StatementSync } from './statement-sync.ts';

/**
 * Options accepted by Node's `DatabaseSync` constructor. Only the members
 * opencode's boot path passes carry behaviour; the rest are accepted (so the
 * constructor does not reject a real opencode call) but inert in the first cut.
 *
 * - `open` (default `true`): open immediately. `open: false` defers opening;
 *   `exec` before {@link DatabaseSync.open} throws the Node-shaped
 *   `database is not open` error.
 * - `enableForeignKeyConstraints` (default `true` in Node): issues
 *   `PRAGMA foreign_keys = ON|OFF` on open. sql.js honours it.
 * - `readOnly` / `allowExtension` / `enableDoubleQuotedStringLiterals` /
 *   `timeout`: inert (see `docs/compat/sqlite.md`). DQS cannot be toggled at
 *   runtime in the prebuilt sql.js WASM, so it is a documented no-op.
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
 * `Error` with `.code === 'ERR_INVALID_STATE'` and message `database is not open`
 * for `exec`/`close`/etc. on a not-open handle; mirrored so consumers branching
 * on `err.code` behave identically.
 */
function notOpenError(): Error {
  const err = new Error('database is not open') as Error & { code: string };
  err.code = 'ERR_INVALID_STATE';
  return err;
}

/**
 * Synchronous `node:sqlite` `DatabaseSync` shim backed by sql.js (ADR-0065,
 * in-memory first cut). Construction, {@link exec}, {@link close} implemented.
 *
 * `filename` is accepted for API parity but NOT used for persistence in the
 * first cut: every database is sql.js in-memory regardless of the path. OPFS
 * cross-reload durability is deferred (ADR-0065 D2 / Q-2026-05-31-301); the boot
 * path uses `OPENCODE_DB=:memory:`, which this matches exactly.
 */
export class DatabaseSync {
  /** Kept for parity; not used for I/O. */
  readonly #filename: string;

  readonly #enableForeignKeyConstraints: boolean;

  /** Live sql.js database, or `undefined` when not open (closed / `open:false`). */
  #db: Database | undefined;

  /**
   * @param filename - Database path; any path maps to an sql.js in-memory db in
   *   the first cut.
   * @param options - See {@link DatabaseSyncOptions}. Defaults match Node:
   *   `open: true`, `enableForeignKeyConstraints: true`.
   * @throws {Error} If the sql.js engine has not been brought up — await
   *   `initSqliteEngine()` before constructing. Synchronous half of the
   *   async-bring-up bridge (ADR-0065 D1).
   */
  constructor(filename: string, options?: DatabaseSyncOptions) {
    this.#filename = filename;
    this.#enableForeignKeyConstraints = options?.enableForeignKeyConstraints ?? true;
    if (options?.open ?? true) {
      this.open();
    }
  }

  /**
   * Open the database: construct the sql.js in-memory db and apply the
   * `PRAGMA foreign_keys` setting from the constructor options.
   *
   * Calling on an already-open database throws the Node-shaped
   * `ERR_INVALID_STATE` (`database is already open`).
   */
  open(): void {
    if (this.#db !== undefined) {
      const err = new Error('database is already open') as Error & { code: string };
      err.code = 'ERR_INVALID_STATE';
      throw err;
    }
    const engine = getSqliteEngine();
    // TODO(ADR): Q-2026-05-31-301 — in-memory-first persistence scope. Fresh
    // sql.js in-memory handle regardless of `#filename`; the OPFS-`SyncAccessHandle`
    // durability follow-up (ADR-0065 D2) replaces this backing site.
    this.#db = new engine.Database();
    this.#db.run(`PRAGMA foreign_keys = ${this.#enableForeignKeyConstraints ? 'ON' : 'OFF'};`);
  }

  /**
   * Execute one or more SQL statements, ignoring returned rows. Mirrors Node's
   * `DatabaseSync.prototype.exec`: accepts a string with MULTIPLE `;`-separated
   * statements (the migration path issues `CREATE TABLE` + `INSERT` in one call)
   * and returns `undefined`.
   *
   * PRAGMAs run through sql.js as-is; in-memory makes WAL moot, but the statement
   * still succeeds (does not throw), which is all the boot path needs (ADR-0065 D3).
   *
   * @param sql - One or more `;`-separated SQL statements.
   * @throws {Error} `ERR_INVALID_STATE` ("database is not open") if closed or
   *   constructed with `open: false` and not yet opened.
   */
  exec(sql: string): undefined {
    if (this.#db === undefined) throw notOpenError();
    this.#db.run(sql);
    return undefined;
  }

  /**
   * Close the database and free its memory. Node throws `ERR_INVALID_STATE`
   * ("database is not open") on a double-close, so this does too (it does NOT
   * silently no-op a second close).
   *
   * @throws {Error} `ERR_INVALID_STATE` if already closed / not open.
   */
  close(): void {
    if (this.#db === undefined) throw notOpenError();
    this.#db.close();
    this.#db = undefined;
  }

  /**
   * Prepare a statement and return a {@link StatementSync} bound to it. Mirrors
   * Node's `DatabaseSync.prototype.prepare(sql)`: compiles the SQL once and hands
   * back a reusable statement whose `all`/`get`/`run` accept positional params.
   * Entry point the effect-drizzle session calls on every query
   * (`native.prepare(q).all(...params)`).
   *
   * @param sql - A single SQL statement, optionally with `?` placeholders.
   * @returns A {@link StatementSync} wrapping the compiled sql.js statement.
   * @throws {Error} `ERR_INVALID_STATE` ("database is not open") if closed or
   *   constructed with `open: false` and not yet opened.
   */
  prepare(sql: string): StatementSync {
    if (this.#db === undefined) throw notOpenError();
    return new StatementSync(this.#db, this.#db.prepare(sql));
  }
}
