---
area: net
status: draft
title: node:sqlite drops a leading U+FEFF from TEXT values and column names
created: 2026-11-17
why: sql.js decodes TEXT with a default TextDecoder, so a TEXT value or column name starting with U+FEFF loses it; Node keeps it
sources: [ADR-0065, docs/process/rules/fault-classes.md]
code: [packages/net/src/sqlite/statement-sync.ts, packages/net/src/sqlite/engine.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), outside its scope.
`statement-sync.ts` `#readRow` (:319 `#stmt.get()`, :321 `#stmt.getAsObject()`)
gets strings already decoded by sql.js@1.14.1 (`engine.ts:23`). Its UTF8ToString
uses a bare `new TextDecoder` (`dist/sql-wasm.js`, `dist/sql-wasm-browser.js`),
which strips the BOM before rifty sees the string. Post-processing can't restore it.

Probe (`node p.mjs`, mkdtemp dir, Node v24.16.0 vs sql.js@1.14.1 on that Node):
`SELECT ? AS v` bound `'\ufeffx'` → Node `feff 78`, sql.js `78`;
`SELECT CAST(X'EFBBBF6869' AS TEXT)` → Node `feff 68 69`, sql.js `68 69`;
alias `"\ufeffc"` key → Node `feff 63`, sql.js `63`. Stored bytes are fine:
`hex(?)` = `EFBBBF78`, `length(?)` = 2. User-function args aren't reachable:
`function()`/`aggregate()` throw (`sqlite-unwired-members`).
Compat: `docs/public/compat/process.md:102` `node:sqlite` ✅, no TEXT caveat.
Fault: corrupt-input (lossy decode) at the sql.js → shim boundary.
Dedup: git grep `sql.js|node:sqlite|BOM|TextDecoder` over docs/backlog,
traps.md, ADR index §Declined: no match (net/sqlite-* cover bigint, metadata,
OPFS, DQS, members, parity, registration).

## Question

Which fix? The decoder is third-party bytes, so patching or rebuilding sql.js is a
vendor adaptation (fault-classes.md §Guest-package adaptations: class,
authority, kill condition, compat ⚠️). Can the shim read column bytes itself
through sql.js 1.14.1's API? Not probed.

## Next

Owner net. Trigger: a claimed node:sqlite workload with BOM-prefixed TEXT
(imported CSV/files). RED first: the three probe queries as a `sqlite/text-leading-bom`
parity case (get + getAsObject + setReturnArrays).
