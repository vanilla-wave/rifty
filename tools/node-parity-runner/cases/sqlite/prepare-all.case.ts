import type { ParityCase } from '../../src/types.ts';

/**
 * `node:sqlite` `StatementSync` parity — the exact opencode boot/query path
 * (ADR-0065, the sql.js-backed shim). This pins `db.prepare(sql)` returning a
 * `StatementSync`, and the THREE methods the effect-drizzle session calls on
 * every query: `all(...positionalParams)`, `setReturnArrays(bool)`, and
 * `setReadBigInts(bool)`. The effect session runs literally
 * `native.prepare(q).all(...params)` with positional `?` placeholders, so this
 * is the head-to-head that proves the query surface boots.
 *
 * Node ≥22 ships a real `node:sqlite`, so the Node side runs the genuine
 * `StatementSync` and the rifty side runs the sql.js-backed shim; the two
 * stdouts must agree byte-for-byte. The `kind: 'sqlite'` mode registers
 * `node:sqlite` on the rifty side and awaits `initSqliteEngine()` so the
 * synchronous `prepare`/`all` calls have their WASM handle ready.
 *
 * What the case pins:
 *   - `prepare('INSERT ... VALUES (?, ?)')` then `run('a', 1)` inserts via
 *     POSITIONAL params (the `?` placeholder form effect uses).
 *   - `prepare('SELECT ...').all('a', 1)` returns OBJECT-keyed rows
 *     (`{ id, n }`) by default — Node's `StatementSync` default row shape.
 *   - `setReturnArrays(true)` then `all(...)` returns ARRAY-shaped rows
 *     (`[id, n]`) — the bare-tuple form.
 *   - `setReadBigInts(false)` (effect's SafeIntegers-default state) yields
 *     PLAIN numbers for INTEGER columns, not BigInt.
 *   - An over-selective `WHERE` yields an EMPTY array `[]` on both sides — the
 *     no-rows case must be `[]`, not `null`/`undefined`/a thrown error.
 *
 * Output discipline: every assertion prints `JSON.stringify(rows)` (a STRING
 * argument), so the rifty console-capture (`formatArgs`) and Node's
 * `console.log` emit the SAME bytes — the comparison is on the serialized row
 * shape, not on inspect formatting. BigInt would make `JSON.stringify` throw,
 * so the `setReadBigInts(false)` plain-number assertion also implicitly proves
 * the values are not BigInt (a regression there would throw, not mismatch).
 *
 * SQL-literal note (same as construct-exec.case.ts): SINGLE-quoted literals are
 * passed as bound params, never inline double-quoted strings — Node's build runs
 * with double-quoted-string compatibility OFF.
 */
const c: ParityCase = {
  kind: 'sqlite',
  code: `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:', { open: true });
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL);');

    const ins = db.prepare('INSERT INTO t (id, n) VALUES (?, ?)');
    ins.run('a', 1);
    ins.run('b', 2);

    const sel = db.prepare('SELECT id, n FROM t WHERE n >= ? AND id >= ? ORDER BY n');

    // Default: object-keyed rows.
    console.log('objects:' + JSON.stringify(sel.all(1, 'a')));

    // setReturnArrays(true): array-shaped rows.
    sel.setReturnArrays(true);
    console.log('arrays:' + JSON.stringify(sel.all(1, 'a')));

    // setReadBigInts(false) (effect's SafeIntegers default): plain numbers.
    // Back to object rows so the key/value shape is visible alongside the type.
    sel.setReturnArrays(false);
    sel.setReadBigInts(false);
    const plain = sel.all(1, 'a');
    console.log('plain:' + JSON.stringify(plain));
    console.log('typeofN:' + typeof plain[0].n);

    // Empty result must be [] on both sides.
    const none = db.prepare('SELECT id, n FROM t WHERE n > ?');
    console.log('empty:' + JSON.stringify(none.all(999)));

    db.close();
  `,
};

export default c;
