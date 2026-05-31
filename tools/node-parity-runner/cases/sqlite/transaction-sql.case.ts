import type { ParityCase } from '../../src/types.ts';

/**
 * `node:sqlite` transaction-control-via-SQL-strings parity (ADR-0065, the sql.js
 * shim). This pins the EXACT shape the effect-drizzle SQLite session uses to
 * drive transactions: there is NO `DatabaseSync` transaction API in Node's
 * `node:sqlite`, and effect does not pretend there is — its
 * `executeTransactionStatement` issues the transaction-control keywords as plain
 * SQL strings through the same connection path every other query uses, i.e.
 * `db.prepare(sql).all()` (vendored
 * `packages/effect-drizzle-sqlite/src/effect-sqlite/session.ts:114-171`). The
 * literal strings effect emits, reproduced verbatim here:
 *
 *   - top level (`id === 0`): `begin deferred` … `commit` / `rollback`
 *   - nested (`id === N`):    `savepoint effect_sql_N` …
 *                             `release savepoint effect_sql_N` /
 *                             `rollback to savepoint effect_sql_N`
 *
 * This is also the real migration-apply shape: `migration.ts` wraps each of the
 * 21 migrations in a transaction, so a working `begin`/`commit`/`rollback` over
 * `prepare().all()` is a literal P2 boot prerequisite.
 *
 * The contract this case pins, head-to-head against Node's genuine `node:sqlite`
 * (Node ≥22 ships it, so the Node side runs the real engine and the rifty side
 * runs the sql.js shim; both stdouts must agree byte-for-byte):
 *
 *   - A transaction-control statement run through `prepare(s).all()` EXECUTES its
 *     side effect (it begins / commits / rolls back the transaction) and returns
 *     `[]` (it yields no rows) — not `null`, not a throw.
 *   - `begin deferred` + INSERT + `commit`: the inserted row PERSISTS after the
 *     statement returns (visible to a later `SELECT`).
 *   - `begin deferred` + INSERT + `rollback`: the inserted row is GONE — the
 *     rollback isolates the uncommitted write, so it must NOT be visible.
 *   - `savepoint effect_sql_1` + INSERT + `release savepoint effect_sql_1`
 *     (nested inside an open `begin deferred`): the row is KEPT (release merges
 *     the savepoint into the enclosing transaction), then the outer `commit`
 *     persists it.
 *   - `savepoint effect_sql_1` + INSERT + `rollback to savepoint effect_sql_1` +
 *     `release savepoint effect_sql_1`: that inner write is UNDONE while the
 *     enclosing transaction's earlier write survives — savepoint isolation must
 *     be exact. The outer `commit` then persists only the surviving rows.
 *
 * Output discipline (same as the sibling sqlite cases): every assertion prints a
 * STRING argument (`'tag:' + JSON.stringify(...)`), so the rifty console-capture
 * (`formatArgs`) and Node's `console.log` emit the SAME bytes — the comparison is
 * on the serialised row set, not on inspect formatting.
 *
 * SQL-literal note (same as the sibling cases): SINGLE-quoted string literals are
 * used for the inserted ids — Node's `node:sqlite` build runs with double-quoted-
 * string compatibility OFF, where `"x"` parses as a column reference and throws.
 */
const c: ParityCase = {
  kind: 'sqlite',
  code: `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:', { open: true });
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');

    // The effect session runs EVERY transaction-control keyword through the same
    // prepare().all() path it uses for ordinary queries — never a dedicated API.
    const run = (s) => db.prepare(s).all();

    // A control statement yields no rows: prepare(s).all() must return [].
    console.log('beginRows:' + JSON.stringify(run('begin deferred')));

    // ---- Top-level COMMIT (id === 0): inserted row persists. ----
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('committed', 1);
    console.log('commitRows:' + JSON.stringify(run('commit')));

    // ---- Top-level ROLLBACK (id === 0): inserted row does NOT persist. ----
    run('begin deferred');
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('rolledback', 2);
    // Visible WITHIN the open transaction, before the rollback resolves.
    console.log('preRollback:' + JSON.stringify(
      db.prepare('SELECT id FROM t ORDER BY id').all()));
    run('rollback');

    // ---- Nested SAVEPOINT (id === 1) under an open begin deferred. ----
    run('begin deferred');
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('outer', 3);

    // savepoint kept: release merges it into the enclosing transaction.
    run('savepoint effect_sql_1');
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('sp_kept', 4);
    console.log('releaseRows:' + JSON.stringify(run('release savepoint effect_sql_1')));

    // savepoint undone: rollback-to then release isolates the inner write only.
    run('savepoint effect_sql_1');
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run('sp_undone', 5);
    console.log('rollbackToRows:' + JSON.stringify(run('rollback to savepoint effect_sql_1')));
    run('release savepoint effect_sql_1');

    // Commit the enclosing transaction: 'outer' and 'sp_kept' survive, 'sp_undone' does not.
    run('commit');

    // Final committed state across all of the above.
    const finalRows = db.prepare('SELECT id, n FROM t ORDER BY id').all();
    console.log('final:' + JSON.stringify(finalRows));

    db.close();
  `,
};

export default c;
