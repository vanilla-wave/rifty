---
area: net
status: draft
title: node:sqlite OPFS durable persistence (vs in-memory-first sql.js)
created: 2026-06-08
why: Every DatabaseSync is a fresh in-memory db regardless of path; no cross-reload durability
user_story: As a dev opening `new DatabaseSync('./app.db')`, I want my writes to survive a page reload, but today every `DatabaseSync` is a fresh in-memory sql.js handle regardless of `#filename` — no OPFS backing, so data vanishes on reload.
sources: [ADR-0065 D2]
code: [packages/net/src/sqlite/database-sync.ts:107]
---
## Context
ADR-0065 ships the `node:sqlite` `DatabaseSync` shim over sql.js, in-memory first cut. `open()` constructs a fresh sql.js in-memory handle regardless of `#filename` — no WAL file, no cross-reload durability. opencode boots via `OPENCODE_DB=:memory:`, which this matches exactly, so it is unblocking-but-incomplete. TODO(backlog: net/sqlite-opfs-persistence) marker at the `:memory:`/in-memory backing seam (database-sync.ts:107).

## Options / Next
Option A (chosen, in-memory now): keep sql.js in-memory; export-to-VFS/OPFS deferred. Option B: adopt `@sqlite.org/sqlite-wasm` + OPFS `SyncAccessHandle` up front — a NEW external dep with its own COI/SAB analysis. Next (gated): durable persistence only when a verified cross-reload-durability need appears; then write the superseding ADR + its own dep ADR, replace the backing site at this marker.

## Reversibility
IRREVERSIBLE when triggered (adopting `@sqlite.org/sqlite-wasm` = new external dependency, checklist rule 2). Currently a gated REVERSIBLE deferral recorded here; the dep is gated here, not adopted.
