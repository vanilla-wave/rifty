import type { ParityCase } from '../../src/types.ts';

/**
 * `node:sqlite` `StatementSync` parity — the DEFAULT `setReadBigInts(false)`
 * read path must THROW for an INTEGER column value that does not fit in a JS
 * `number` (ADR-0065, finding #2). Node's real `node:sqlite`, when
 * `setReadBigInts` is `false` (its default, and effect's SafeIntegers-default
 * state), refuses to silently lose precision: reading an INTEGER whose magnitude
 * exceeds `Number.MAX_SAFE_INTEGER` (`9007199254740991`) throws a `RangeError`
 * with code `ERR_OUT_OF_RANGE`, rather than returning a truncated float. The
 * rifty sql.js-backed shim previously truncated silently (sql.js stores every
 * INTEGER as a JS `number`, so `9223372036854775807` came back as the lossy
 * `9223372036854776000`); this case pins the corrected throw so the shim matches
 * Node byte-for-byte.
 *
 * Node ≥22 ships a real `node:sqlite`, so the Node side runs the genuine
 * `StatementSync` and the rifty side runs the sql.js-backed shim; the two
 * stdouts must agree byte-for-byte. The `kind: 'sqlite'` mode registers
 * `node:sqlite` on the rifty side and awaits `initSqliteEngine()` so the
 * synchronous `prepare`/`get` calls have their WASM handle ready.
 *
 * What the case pins (the boundary verified head-to-head against Node v24):
 *   - A safe-range INTEGER (`9007199254740991`, exactly `Number.MAX_SAFE_INTEGER`)
 *     reads back as a PLAIN number on both engines — NO throw.
 *   - `Number.MAX_SAFE_INTEGER + 1` (`9007199254740992`, i.e. `2^53`) is the
 *     first value Node refuses: it throws `RangeError` / `ERR_OUT_OF_RANGE`. The
 *     shim must throw the SAME named error + code.
 *   - A clearly-out-of-range INT64 (`9223372036854775807`, INT64 max) throws the
 *     same `RangeError` / `ERR_OUT_OF_RANGE` — the value the shim used to
 *     truncate to `9223372036854776000`.
 *   - The negative boundary mirrors the positive one: `-9007199254740991` reads
 *     back fine, `-9007199254740993` throws.
 *
 * Bound BigInt params (`?` placeholders) are used to INSERT the exact 64-bit
 * integers — that is the only way to get a value past `2^53` into the column
 * without the literal itself being a lossy JS number on the way in. The reads
 * use the default `setReadBigInts(false)` state (no `setReadBigInts` call), which
 * is exactly the state effect's `Client.SafeIntegers` Context.Reference defaults
 * to in effect@4.0.0-beta.66.
 *
 * Output discipline (same as the sibling cases): every assertion prints a STRING
 * argument — either `'tag:' + String(value)` for the no-throw reads or
 * `'tag:' + err.constructor.name + ':' + err.code` for the throws — so the rifty
 * console-capture (`formatArgs`) and Node's `console.log` emit the SAME bytes.
 * A throw is caught and serialised (name + code), never allowed to crash the
 * process (which would make the Node child exit non-zero and the case error out
 * instead of comparing).
 *
 * SQL-literal note (same as the sibling cases): SINGLE-quoted literals / bound
 * params only, never inline double-quoted strings — Node's build runs with
 * double-quoted-string compatibility OFF.
 */
const c: ParityCase = {
  kind: 'sqlite',
  code: `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:', { open: true });
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, big INTEGER NOT NULL);');

    const ins = db.prepare('INSERT INTO t (id, big) VALUES (?, ?)');
    // Bound BigInt params write the EXACT 64-bit integers into the INTEGER column.
    ins.run(1, 9007199254740991n);   // == Number.MAX_SAFE_INTEGER (safe)
    ins.run(2, 9007199254740992n);   // == MAX_SAFE + 1 (== 2^53), first unsafe
    ins.run(3, 9223372036854775807n);// INT64 max (clearly out of range)
    ins.run(4, -9007199254740991n);  // == -MAX_SAFE_INTEGER (safe)
    ins.run(5, -9007199254740993n);  // below -MAX_SAFE (unsafe)

    const sel = db.prepare('SELECT big FROM t WHERE id = ?');

    // No setReadBigInts call -> default false (effect's SafeIntegers default).
    function read(id) {
      try {
        const row = sel.get(id);
        return 'ok:' + String(row.big) + ':' + typeof row.big;
      } catch (e) {
        return 'throw:' + e.constructor.name + ':' + e.code;
      }
    }

    console.log('maxSafe:' + read(1));
    console.log('maxSafePlus1:' + read(2));
    console.log('int64max:' + read(3));
    console.log('negMaxSafe:' + read(4));
    console.log('negUnsafe:' + read(5));

    db.close();
  `,
};

export default c;
