---
area: net
status: parked
title: node:sqlite setReadBigInts(true) BigInt INTEGER read mode
created: 2026-06-08
why: Prebuilt sql.js WASM stores INTEGER as JS number; no bigint read mode — needs custom WASM rebuild
sources: [ADR-0065 D4, docs/compat/sqlite.md StatementSync.setReadBigInts(true)]
---
## Context
`StatementSync.setReadBigInts(true)` is ❌ — throws `NotImplementedError('sqlite.Statement.setReadBigInts(true)')`. The prebuilt sql.js WASM stores every INTEGER column as a JS `number`; the value is already lossy above `Number.MAX_SAFE_INTEGER` before any `BigInt` cast, so faking BigInt would silently lose precision. Not on opencode's path: effect's `Client.SafeIntegers` defaults `false`, so the boot/first-flow calls `setReadBigInts(false)` (the supported plain-number read). Default `setReadBigInts(false)` is ✅ and refuses overflow rather than truncating (ADR-0065 finding #2).

## Options / Next
Closing requires a custom sql.js WASM rebuild exposing a per-column `sqlite3_column_type` accessor + a genuine 64-bit read path. Next (gated): only if a target needs exact 64-bit integer reads; until then it throws loudly per the no-silent-stubs rule.

## Reversibility
IRREVERSIBLE when pursued (custom WASM rebuild / possible new dep). Parked behind a verified-need gate; current loud-throw is the recorded scope.
