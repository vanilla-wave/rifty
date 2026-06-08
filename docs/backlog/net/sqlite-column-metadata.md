---
area: net
status: parked
title: node:sqlite StatementSync.columns() column metadata
created: 2026-06-08
why: sql.js compiled without SQLITE_ENABLE_COLUMN_METADATA; faithful shape unavailable — needs custom WASM rebuild
sources: [ADR-0065]
---
## Context
`StatementSync.columns()` is ❌ — throws `NotImplementedError('sqlite.StatementSync.columns')`. Node returns `{column, database, name, table, type}` per column, which needs SQLite's `SQLITE_ENABLE_COLUMN_METADATA` build (`sqlite3_column_table_name`/`_database_name`/`_origin_name`/`_decltype`). The prebuilt sql.js WASM exposes only `sqlite3_column_name`, so a faithful shape is unavailable; a partial shape would be a silent stub. Not on opencode's boot/query path.

## Options / Next
Closing requires a custom sql.js WASM rebuild compiled with `SQLITE_ENABLE_COLUMN_METADATA`. Next (gated): only when a consumer needs `columns()`; until then loud-throw per no-silent-stubs.

## Reversibility
IRREVERSIBLE when pursued (custom WASM rebuild). Parked behind a verified-need gate; loud-throw is the recorded scope.
