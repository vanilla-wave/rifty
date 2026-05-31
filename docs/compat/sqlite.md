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
| `prepare(sql)` | ❌ | `NotImplementedError('sqlite.DatabaseSync.prepare')` — sql.js-backed prepared statements (`StatementSync.run`/`all`/`get`) land in a follow-up task as opencode's parameterized-query path needs them. |
| `location()` | ❌ | Not yet wired (`NotImplementedError` when added). |
| `function()` / `aggregate()` | ❌ | User-defined functions — not on the boot path. |
| `createSession()` / `applyChangeset()` | ❌ | Session extension — not on the boot path. |
| `enableLoadExtension()` / `loadExtension()` | ❌ | Loadable extensions — unsupported in the WASM build. |

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
