import type { ParityCase } from '../../src/types.ts';

/**
 * `node:sqlite` `DatabaseSync` constructor + `exec()` + `close()` parity
 * (ADR-0065, the sql.js-backed shim). This is the FIRST head-to-head case for
 * the `node:sqlite` surface — Node ≥22 ships a real `DatabaseSync`, so the Node
 * side runs the genuine module and the rifty side runs the sql.js shim, and the
 * two stdouts must agree.
 *
 * It is enabled by the runner's opt-in `kind: 'sqlite'` mode: the default parity
 * modes import only `@riftydev/runtime-js/loader` and never register `node:sqlite`
 * (the shim lives in `@riftydev/net`, like `node:http`). The `'sqlite'` mode does
 * two things the default modes don't (mirroring how `'http'` registers
 * `node:net`/`node:http`): it imports `@riftydev/net/sqlite/register-builtins` so
 * `require('node:sqlite')` resolves, and it AWAITS `initSqliteEngine()` so the
 * synchronous `DatabaseSync` constructor has its sql.js handle ready before the
 * case `code` runs (the WASM bring-up is the one async step the synchronous
 * surface depends on — Q-2026-05-31-303 / ADR-0065 D1).
 *
 * What the case pins — the exact opencode boot path (Spike C / ADR-0065):
 *   - `new DatabaseSync(':memory:', { enableForeignKeyConstraints, open: true })`
 *     opens an in-memory database synchronously (no throw).
 *   - `exec()` runs a MULTI-statement string in one call (the migration path
 *     issues `CREATE TABLE` + `INSERT` together) and returns `undefined`.
 *   - `exec('PRAGMA journal_mode = WAL;')` does not throw — sql.js is in-memory
 *     so real WAL is moot, but opencode only needs the PRAGMA to succeed.
 *   - `close()` releases the database.
 *
 * SQL-literal note: the `INSERT` uses SINGLE-quoted string literals
 * (`'a'`, `'b'`), not double-quoted. Node's `node:sqlite` build runs with SQLite
 * double-quoted-string (DQS) compatibility OFF, so `VALUES ("a", 1)` is parsed
 * as a (non-existent) column reference and Node THROWS
 * `ERR_SQLITE_ERROR: no such column: "b"`. Single quotes are the canonical SQL
 * string literal and the only form that both opens-and-inserts AND matches Node.
 * (The first-cut sql.js build leaves DQS ON with no runtime toggle, so the
 * double-quoted form would DIVERGE — it is a documented first-cut gap in
 * `docs/backlog/net/sqlite-options-and-dqs.md`, NOT something this case relies on.)
 */
const c: ParityCase = {
  kind: 'sqlite',
  // Lock stdout so a regression where BOTH sides silently emit nothing (e.g. the
  // case throws before the log on both) can't "match" on two empty strings.
  expected: 'ok',
  code: `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true, open: true });
    db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL); INSERT INTO t VALUES ('a', 1), ('b', 2);");
    db.exec('PRAGMA journal_mode = WAL;');
    console.log('ok');
    db.close();
  `,
};

export default c;
