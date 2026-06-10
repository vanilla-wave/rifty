import type { ParityCase } from '../../src/types.ts';

/**
 * `node:sqlite` `StatementSync` parity — the full query surface BEYOND the boot
 * path (ADR-0065, the sql.js-backed shim). The companion case
 * `prepare-all.case.ts` pins `all` + the row-shape toggles; this one pins the
 * remaining `StatementSync` members the contract owes: `run`'s result object,
 * `get` (first row / `undefined`), `iterate` (lazy, in-order), and the
 * named-parameter binding forms (`:`-prefixed and bare-with-toggle).
 *
 * Node ≥22 ships a real `node:sqlite`, so the Node side runs the genuine
 * `StatementSync` and the rifty side runs the sql.js-backed shim; the two
 * stdouts must agree byte-for-byte. The `kind: 'sqlite'` mode registers
 * `node:sqlite` on the rifty side and awaits `initSqliteEngine()` so the
 * synchronous `prepare`/`run`/`get`/`iterate` calls have their WASM handle ready.
 *
 * What the case pins:
 *   - `prepare('INSERT ...').run('id', 5)` returns plain-number
 *     `lastInsertRowid` and `changes` fields equal to Node (here
 *     `lastInsertRowid: 1`, `changes: 1` for the first row), and the same on a
 *     second insert (`lastInsertRowid: 2`). The case prints fields explicitly
 *     because Node patch versions have differed in object insertion order.
 *   - `get(...)` returns the FIRST result row (object-keyed) like Node, and
 *     `undefined` (serialised by `JSON.stringify` to the literal absence — we
 *     print `String(row)` for the no-row case so `undefined` is visible) when no
 *     row matches.
 *   - `iterate(...)` yields rows LAZILY and IN ORDER; collecting the iterator
 *     into an array must equal `all(...)` and equal Node's iteration order.
 *   - Named params: the `:`-prefixed object form (`get({ ':id': 'b' })`) binds
 *     by name on both engines. After `setAllowBareNamedParameters(true)` the
 *     BARE object form (`get({ id: 'b' })`) binds the same way — the toggle the
 *     effect session relies on so it can pass plain `{ id }` objects.
 *
 * Output discipline (same as the sibling cases): every assertion prints a STRING
 * argument (`'tag:' + JSON.stringify(...)` or `String(...)`), so the rifty
 * console-capture (`formatArgs`) and Node's `console.log` emit the SAME bytes —
 * the comparison is on the serialised shape, not on inspect formatting.
 *
 * SQL-literal note (same as the sibling cases): SINGLE-quoted literals are passed
 * as bound params, never inline double-quoted strings — Node's build runs with
 * double-quoted-string compatibility OFF.
 */
const c: ParityCase = {
  kind: 'sqlite',
  code: `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:', { open: true });
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');

    // run() returns lastInsertRowid + changes with plain-number fields.
    const ins = db.prepare('INSERT INTO t (id, n) VALUES (?, ?)');
    const r1 = ins.run('a', 5);
    console.log('run1:' + r1.lastInsertRowid + ',' + r1.changes);
    const r2 = ins.run('b', 2);
    console.log('run2:' + r2.lastInsertRowid + ',' + r2.changes);
    ins.run('c', 9);

    // get() returns the first row, in declared order, or undefined for no match.
    const sel = db.prepare('SELECT id, n FROM t ORDER BY n');
    console.log('get:' + JSON.stringify(sel.get()));
    const none = db.prepare('SELECT id, n FROM t WHERE n > ?');
    console.log('getNone:' + String(none.get(999)));

    // iterate() yields rows lazily, in the same order as all().
    const collected = [];
    for (const row of sel.iterate()) collected.push(row);
    console.log('iterate:' + JSON.stringify(collected));
    console.log('iterateEqualsAll:' + (JSON.stringify(collected) === JSON.stringify(sel.all())));

    // Named params, :-prefixed object form.
    const byName = db.prepare('SELECT id, n FROM t WHERE id = :id');
    console.log('prefixed:' + JSON.stringify(byName.get({ ':id': 'b' })));

    // Named params, bare object form after enabling bare named parameters.
    const bare = db.prepare('SELECT id, n FROM t WHERE id = :id');
    bare.setAllowBareNamedParameters(true);
    console.log('bare:' + JSON.stringify(bare.get({ id: 'b' })));

    db.close();
  `,
};

export default c;
