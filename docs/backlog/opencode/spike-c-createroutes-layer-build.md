---
area: opencode
status: active
title: Spike C — real createRoutes layer-build vs the vendored tree (DB tier-sequencing decision)
created: 2026-06-08
why: M12 gate that decides WASM-SQLite P2-vs-P4; gated on F01 vendored tree
sources: [TASKS M12 Spike C, docs/opencode/README.md §Spike C, ADR-0065, audit-digest]
---
## Context
Static analysis vs the vendored tree (high confidence; no live boot). Decides DB tier sequencing. VERDICT: eager-database — `Server.listen` (server.ts:75) → `Layer.buildWithMemoMap` (:129, eager full-DAG) → `createRoutes` UNCONDITIONALLY provides `Database.defaultLayer`; `fenceLayer` acquire runs `yield* Database.Service` at layer-build, forcing `Database.layer` acquire = `makeDatabase` + `PRAGMA journal_mode=WAL` (+5) + `DatabaseMigration.apply` (~24 DDL files) under `Effect.orDie` — all BEFORE any request. Stale task premise: `#db` map points at `storage/db.{node,bun}.ts` which DON'T exist at this SHA; nothing imports `#db`; real DB = `Database` from `@opencode-ai/core/database` via `node:sqlite` under the `node` condition.
## Options / Next
Implication: a throw-on-USE SQLite stub is NOT sufficient — first `db.run` dies the layer build. Pulls WASM-SQLite forward P4→P2 (boot prerequisite). Engine decision RATIFIED as ADR-0065: sql.js (pure-JS WASM SQLite, synchronous, in-memory-first), `node:sqlite` builtin with `DatabaseSync`-compatible surface. Spike's eager-Database prediction LIVE-CONFIRMED (GRAPH-LOAD + BOOT passed). Next: spike is complete; remaining downstream = the live gates (boot, dbread done; Phase 3 LLM live).
## Reversibility
IRREVERSIBLE conclusion → ratified inline as ADR-0065 (sql.js engine + node:sqlite DatabaseSync builtin; supersedes decisions.md drafts 0055/0056). Spike itself decision-bearing not impl.
