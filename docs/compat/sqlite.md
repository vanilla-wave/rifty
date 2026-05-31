# Compatibility matrix — `node:sqlite` (ADR-0065)

The rifty `node:sqlite` `DatabaseSync` shim, backed by `sql.js` (pure-JS WASM
SQLite, synchronous, in-memory for the first cut — ADR-0065). Registered as a
builtin via `@rifty/net/sqlite/register-builtins` (opt-in, harness-local — not
loaded into every realm). The engine must be brought up
(`initSqliteEngine()` awaited) before the synchronous `DatabaseSync` constructor
runs (ADR-0065 D1).

This file is maintained by hand for the surface the shim deliberately throws on
(per the no-silent-stubs rule); the auto-generated matrices
(`pnpm compat:generate`) cover behaviours pinned by conformance/integration
tests at milestone DoD.

**Boot subset (P2 gate): ✅.** opencode's literal database-boot sequence — open
`:memory:`, `PRAGMA journal_mode = WAL` + the five other boot PRAGMAs, the
`migration` journal table, fresh-boot seed detection, and the first real
migration (`20260127222353_familiar_lady_ursula`: eight `CREATE TABLE`s with
forward FKs + six `CREATE INDEX`es) inside a `begin deferred` … `commit`
transaction — completes without throwing and the committed migration row reads
back. Pinned by the conformance gate
`tests/conformance/builtins/sqlite-opencode-boot.test.ts` (runs the sequence
through `require('node:sqlite')` in the real loader) and its head-to-head twin
`tools/node-parity-runner/cases/sqlite/opencode-boot-sequence.case.ts` (byte-for-byte
vs real Node `node:sqlite`). This is the P2 boot prerequisite — opencode's
`Server.listen` builds it at layer-build time before any request (ADR-0065).

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not
implemented (throws `NotImplementedError`).

## `DatabaseSync`

| Member | Status | Notes |
|---|---|---|
| `new DatabaseSync(path, options?)` | ✅ | In-memory regardless of `path` (first cut); `:memory:` is the opencode boot path. Pinned by parity case `cases/sqlite/construct-exec.case.ts`. |
| `options.open` (default `true`) | ✅ | `open: false` defers opening; `exec` before `open()` throws `ERR_INVALID_STATE`. |
| `options.enableForeignKeyConstraints` (default `true`) | ✅ | Applied as `PRAGMA foreign_keys = ON\|OFF` on open. |
| `options.readOnly` / `allowExtension` / `timeout` | ⚠️ | Accepted but inert in the first cut. |
| `options.enableDoubleQuotedStringLiterals` | ⚠️ | No-op — the prebuilt sql.js WASM has no runtime DQS toggle (see DQS caveat below). |
| `exec(sql)` | ✅ | Multi-statement (`;`-separated) supported; returns `undefined`. PRAGMAs (incl. `journal_mode = WAL`) run as-is and do not throw. Pinned by the parity case. |
| `close()` | ✅ | Frees the database; double-close throws `ERR_INVALID_STATE` ("database is not open"), matching Node. |
| `open()` | ✅ | Opens a deferred (`open: false`) handle; re-opening an open handle throws `ERR_INVALID_STATE`. |
| `prepare(sql)` | ✅ | Returns a `StatementSync` wrapping the compiled sql.js statement. Throws `ERR_INVALID_STATE` if the database is not open. Pinned by parity case `cases/sqlite/prepare-all.case.ts`. |
| `location()` | ❌ | Not yet wired (`NotImplementedError` when added). |
| `function()` / `aggregate()` | ❌ | User-defined functions — not on the boot path. |
| `createSession()` / `applyChangeset()` | ❌ | Session extension — not on the boot path. |
| `enableLoadExtension()` / `loadExtension()` | ❌ | Loadable extensions — unsupported in the WASM build. |

## `StatementSync`

Returned by `DatabaseSync.prepare(sql)`. The query surface the effect-drizzle
session inside opencode calls on every query (`native.prepare(q).all(...
params)`).

| Member | Status | Notes |
|---|---|---|
| `all(...params)` | ✅ | Positional `?` params or a single named-parameter object; object-keyed rows by default, array tuples after `setReturnArrays(true)`; empty result is `[]`. Pinned by parity case `cases/sqlite/prepare-all.case.ts`. |
| `get(...params)` | ✅ | First row in the configured shape, or `undefined` when no rows match. Pinned by parity case `cases/sqlite/run-get-iterate.case.ts`. |
| `run(...params)` | ✅ | Executes DML; returns `{ lastInsertRowid, changes }` (plain numbers) from `last_insert_rowid()` / `getRowsModified()`. Pinned by parity case `cases/sqlite/run-get-iterate.case.ts`. |
| `iterate(...params)` | ✅ | Lazy generator; yields rows in cursor order (the configured shape), resets the statement on exhaustion / early `break`. Pinned by parity case `cases/sqlite/run-get-iterate.case.ts`. |
| Named parameters (`:name` / `@name` / `$name`) | ✅ | A single object first argument binds by name. Sigil-prefixed keys (`{ ':id' }`) pass through; bare keys (`{ id }`) are prefixed with `:` when bare keys are allowed. Pinned by parity case `cases/sqlite/run-get-iterate.case.ts`. |
| `setAllowBareNamedParameters(bool)` | ✅ | Defaults to `true` (as Node). `false` → bare named-param keys throw `ERR_INVALID_STATE`. |
| `setReturnArrays(bool)` | ✅ | `true` → bare value-tuple rows; `false` (default) → object-keyed rows. |
| `setReadBigInts(false)` | ⚠️ | Default (also effect's `Client.SafeIntegers` Context.Reference default — `false` in effect@4.0.0-beta.66, invoked per-query by the real `@effect/sql-sqlite-node` driver) → INTEGER columns read as plain `number`. **NOT silent on overflow:** an INTEGER past `Number.MAX_SAFE_INTEGER` throws Node's `RangeError` / `ERR_OUT_OF_RANGE` (matching Node v24 — the first refused value is `2^53` = `MAX_SAFE + 1`), rather than returning a truncated float (ADR-0065 finding #2). Pinned by parity case `cases/sqlite/read-bigint-overflow.case.ts`. |
| `setReadBigInts(true)` | ❌ | `NotImplementedError('sqlite.Statement.setReadBigInts(true)')` — the prebuilt sql.js WASM stores INTEGER columns as JS `number`s and has no bigint read mode; faking `BigInt` would silently lose precision above `Number.MAX_SAFE_INTEGER` (the number is already lossy before the cast). No silent fallback (ADR-0065 D4). |
| `columns()` | ❌ | `NotImplementedError('sqlite.StatementSync.columns')` — Node returns `{ column, database, name, table, type }`, which needs SQLite's `SQLITE_ENABLE_COLUMN_METADATA` build (`sqlite3_column_table_name` / `_database_name` / `_origin_name` / `_decltype`). The prebuilt sql.js WASM is compiled without it (only `sqlite3_column_name` is exposed), so a faithful shape is unavailable; a partial shape would be a silent stub. Not on the boot/query path. |
| `expandedSQL` / `sourceSQL` | ❌ | Not yet wired (`NotImplementedError` when added). |

## Known caveats (first cut)

- **In-memory only.** No cross-reload durability; every `DatabaseSync` is a
  fresh sql.js in-memory database regardless of `path`. OPFS persistence via
  `@sqlite.org/sqlite-wasm` + `SyncAccessHandle` is the deferred follow-up
  (ADR-0065 D2 / Q-2026-05-31-301). opencode boots via `OPENCODE_DB=:memory:`,
  which this matches exactly.
- **Double-quoted string (DQS) compatibility is ON and cannot be toggled.**
  Node's `node:sqlite` runs with DQS OFF, so `INSERT INTO t VALUES ("x", 1)`
  throws `ERR_SQLITE_ERROR: no such column: "x"`; the prebuilt sql.js WASM leaves
  DQS ON and exposes no runtime toggle (`PRAGMA legacy_double_quoted_strings` is
  inert), so it silently accepts the same statement as a string literal. Use
  single-quoted SQL string literals (the canonical form) for cross-engine parity.
  Toggling DQS off would require a custom sql.js WASM rebuild — out of scope for
  the in-memory first cut.
- **`PRAGMA journal_mode = WAL` succeeds but is moot.** sql.js is in-memory, so
  there is no WAL file; the PRAGMA runs without throwing (which is all opencode's
  boot path requires) and reports the journal mode sql.js applies.
- **No BigInt INTEGER reads; no column metadata.** Two `StatementSync` members
  throw `NotImplementedError` rather than fake a value, because the prebuilt
  sql.js WASM cannot back them: `setReadBigInts(true)` (the engine stores every
  INTEGER in a JS `number`, so a `BigInt` cast would silently lose precision
  above `Number.MAX_SAFE_INTEGER`) and `columns()` (the engine is compiled
  without `SQLITE_ENABLE_COLUMN_METADATA`, so the per-column
  table/database/declared-type that Node's `columns()` returns are unavailable;
  only `sqlite3_column_name` is exposed). Both would require a custom sql.js WASM
  rebuild — out of scope for the in-memory first cut. They are not on opencode's
  boot/query path.
- **Default INTEGER reads throw on overflow instead of truncating
  (ADR-0065 finding #2).** Under the default `setReadBigInts(false)`, an INTEGER
  value past `Number.MAX_SAFE_INTEGER` throws `RangeError` / `ERR_OUT_OF_RANGE`,
  matching Node v24 (which refuses to return a truncated float). The shim detects
  this from the returned value (`Number.isInteger(v) && !Number.isSafeInteger(v)`)
  because the prebuilt sql.js WASM exposes no per-column `sqlite3_column_type`
  accessor on its public API. **Known limitation:** a REAL column holding a
  whole-number value above `2^53` is indistinguishable from a truncated INTEGER
  given only the JS number, so it is guarded too (Node would return that REAL
  without throwing). This is a rare, exotic edge; the shim errs toward refusing a
  possibly-truncated value rather than silently presenting one as exact. The
  exact, non-throwing path for genuine 64-bit integers is the (unsupported)
  `setReadBigInts(true)` BigInt mode.

## opencode-flow notes (ADR-0065 erratum, 2026-05-31)

Two facts about how opencode actually drives this surface at SHA `f401f01`,
mirrored from the ADR-0065 erratum:

- **drizzle IS wired over `node:sqlite` `DatabaseSync`.** Earlier framing called
  the drizzle adapter "void / a red herring at this SHA"; that was inaccurate.
  `drizzle-orm/node-sqlite` consumes the SAME `DatabaseSync` instance as
  `@effect/sql-sqlite-node`. There is still no drizzle subpath redirect to write
  (drizzle rides the `DatabaseSync` surface this shim provides), but the shim
  must satisfy drizzle's `DatabaseSync` usage too —
  `prepare(...).all/.get/.run`, `setReturnArrays`, `setReadBigInts`, `exec` —
  which it already does, since both consumers share that surface.
- **First-flow correctness rests on `setReadBigInts(false)` being the default.**
  effect's `Client.SafeIntegers` is a `Context.Reference` defaulting to `false`
  in effect@4.0.0-beta.66 (verified in source); the real driver invokes
  `setReadBigInts(...)` per-query from that reference, so the boot/first-flow path
  calls `setReadBigInts(false)` (the supported plain-`number` read), never
  `setReadBigInts(true)` (which throws `NotImplementedError`). That is why the
  shim boots opencode despite the BigInt-mode throw.
