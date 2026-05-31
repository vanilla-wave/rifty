# ADR 0065: `node:sqlite` `DatabaseSync` WASM shim — sql.js, in-memory-first (P2 boot prerequisite)

Status: Accepted (supersedes decisions.md DRAFTS ADR-0055 + ADR-0056; opencode facade M12)
Date: 2026-05-31

## Context

opencode (anomalyco/opencode, vendored at SHA
`f401f01c05bead2fd0687004c912743d271e2b7b`,
`tests/integration/fixtures/opencode/source`) does NOT lazily open its database.
**Spike C** (static analysis against the vendored tree; verdict in
`docs/opencode/README.md`) verified the chain:

`Server.listen` (`server.ts:75`) → `Layer.buildWithMemoMap` (`:129`, **eager
full-DAG build**) → `HttpApiApp.createRoutes` unconditionally provides
`fenceLayer.pipe(Layer.provide(Database.defaultLayer))` (`httpapi/server.ts:193,195`).
`fenceLayer` is a `Layer.effect` whose **acquire** runs
`const { db } = yield* Database.Service` (`middleware/fence.ts:9-11`) — at
layer-build, not per-request. That forces `Database.layer`
(`@opencode-ai/core` `database.ts:21`) whose acquire runs `makeDatabase`,
`PRAGMA journal_mode = WAL` + ~5 more PRAGMAs, then
`DatabaseMigration.apply(db)` (~24 migration files, real `CREATE TABLE` /
`SELECT` / `INSERT` DDL inside transactions) — all under `Effect.orDie`.
`makeDatabase` → `sqlite.node.ts` runs `new DatabaseSync(filename, {open: true})`
(`:151,156`) over a top-level `import … from "node:sqlite"` (`:1`).

So **booting `Server.listen` at all requires a WORKING `node:sqlite`
`DatabaseSync`** that can open `:memory:`, tolerate/no-op `PRAGMA
journal_mode=WAL`, and execute the migration DDL — *before any request is
served*. A throw-on-USE stub is insufficient: the first `db.run` during the
migration dies the layer build and fails `Server.listen`. This is now a
**proven need**, not an assumed one — opencode's own boot tests confirm it
(`test/preload.ts` sets `OPENCODE_DB=:memory:` to provision a real SQLite for
the HTTP layer).

**Premise corrections from Spike C** (recorded so this ADR is honest about the
prior draft framing):
- The `#db` import map (`package.json` `imports`) is **stale** — its targets
  (`src/storage/db.{node,bun}.ts`) do NOT exist at this SHA and nothing imports
  `#db`. The live target is `@opencode-ai/core/database`, NOT a `#db`-routed
  module. The draft ADR-0055/0056 framing of intercepting `bun:sqlite` via the
  `#db` `bun` branch is therefore moot.
- rifty resolves under the **`node`** condition, so the relevant specifier is
  `node:sqlite` (Node ≥22 `DatabaseSync`), NOT `bun:sqlite`. The shim target is
  `@effect/sql-sqlite-node`'s `DatabaseSync` usage (effect@4.0.0-beta.66,
  `@effect/sql-sqlite-node`), NOT drizzle/bun-sqlite. (At this SHA opencode uses
  `@effect/sql-sqlite-node` over `node:sqlite` `DatabaseSync`, not drizzle.)

This decision is made under ADR-0063/0064 standing authority (record-and-continue;
a verified-need dependency commitment is an inflection, not a stop) with the
Spike C need verified.

## Decision

- **D1 — Engine: `sql.js` (pure-JS Emscripten SQLite, WASM, SYNCHRONOUS API,
  in-memory).** rifty's `node:sqlite` shim is backed by `sql.js` for the first
  cut. `sql.js` exposes a fully **synchronous** `Database` (after a one-time
  async WASM module init), which is the load-bearing property: opencode's
  `DatabaseSync` surface and `@effect/sql-sqlite-node`'s usage are synchronous,
  and opencode's own boot path is `OPENCODE_DB=:memory:`. A synchronous WASM
  SQLite that opens `:memory:` matches that boot path with no async-impedance
  mismatch.

- **D2 — In-memory first; OPFS persistence DEFERRED.** The first cut is
  in-memory only. Cross-reload durability via `@sqlite.org/sqlite-wasm` + OPFS
  `SyncAccessHandle` is a later follow-up (see Q-2026-05-31-301), out of scope
  here. opencode boots and serves with `:memory:`; durability is not on the
  boot/first-light path.

- **D3 — Registered as a rifty `node:sqlite` builtin exposing a
  `DatabaseSync`-compatible synchronous surface.** The shim is a builtin that
  intercepts the `node:sqlite` specifier and presents a `DatabaseSync`-shaped
  object (constructor `(filename, {open}?)`, the `.exec`/`.prepare`/`.run`/`.all`/
  `.get`/`.close` methods opencode and `@effect/sql-sqlite-node` actually call,
  and tolerant/no-op handling of `PRAGMA journal_mode=WAL`). The exact builtin
  registration module path is a reversible sub-decision (Q-2026-05-31-302).
  No `bun:sqlite` interception, no drizzle driver redirect (corrected from the
  drafts — see Context).

- **D4 — No silent stubs.** Methods opencode does not exercise on the boot/
  first-light path that `sql.js` cannot back stay as directed
  `NotImplementedError` throws with a compat-matrix entry, never fake values.
  The migration DDL, the PRAGMAs opencode issues, and `:memory:` open MUST
  actually work (that is the whole point of pulling this to P2).

### Why `sql.js` over `@sqlite.org/sqlite-wasm` for the first cut

ADR-0006's substitution-source ordering (source #4) names
`@sqlite.org/sqlite-wasm` as an existing WASM rebuild to lean on. This decision
**diverges** from that ordering for the first cut, and per ADR-0006 governance
the divergence is documented here:

- The official `@sqlite.org/sqlite-wasm` build's ergonomic surface is the
  async/OO API (and its persistent variant requires OPFS + a Worker). opencode's
  boot path is **synchronous** `DatabaseSync` over `:memory:`. A synchronous
  in-memory engine is the minimal thing that boots the layer DAG; `sql.js`
  provides exactly that with a single `.wasm` + glue and a synchronous
  `Database`. Forcing the async official build through a synchronous
  `DatabaseSync` facade at boot would fight the API the boot path needs.
- `@sqlite.org/sqlite-wasm` is NOT abandoned here — it is the **engine for the
  deferred OPFS-persistence follow-up** (D2 / Q-2026-05-31-301), where its OPFS
  `SyncAccessHandle` VFS is the right tool. The first cut picks the engine that
  matches the synchronous in-memory boot; persistence picks the engine that
  matches durable OPFS. This keeps the ADR-0006 source #4 engine in the
  trajectory rather than rejecting it.
- `wa-sqlite` / `absurd-sql` were rejected for the first cut: async +
  COI/SharedArrayBuffer (wa-sqlite) or a second durable-VFS dependency
  (absurd-sql), both fighting the synchronous boot need.

### Relationship to ADR-0002 (cross-origin isolation / SharedArrayBuffer)

- **In-memory `sql.js` needs NEITHER COI NOR SAB.** It is a self-contained WASM
  module operating on its own linear memory; it does not require
  `SharedArrayBuffer` or cross-origin isolation. So the P2 boot prerequisite
  (this ADR) adds **no new COI/SAB dependency** beyond what ADR-0002 already
  mandates for the rest of rifty.
- The **deferred OPFS-persistence follow-up WILL interact with ADR-0002**:
  `@sqlite.org/sqlite-wasm` + OPFS `SyncAccessHandle` requires COI (and runs its
  sync access off the main thread). That COI/SAB analysis belongs to the
  persistence follow-up (Q-2026-05-31-301), not to this in-memory first cut.

## Consequences

- **WASM-SQLite is re-cut from a P4 need to a P2 boot prerequisite.** It must
  land before any server-boot smoke test (it is on the `Server.listen`
  layer-build path), not deferred to P4 session storage. PROJECT_PLAN.md M12 and
  `docs/opencode/README.md` reflect this re-cut.
- **New external dependency: `sql.js`** (IRREVERSIBLE per reversibility rule 2 —
  hence this ADR). The deferred persistence engine `@sqlite.org/sqlite-wasm` is
  NOT added now (Q-2026-05-31-301 gates it).
- **The `bun:sqlite`-intercept framing is corrected to `node:sqlite`.** rifty
  resolves under the `node` condition; the shim intercepts `node:sqlite` and
  presents a synchronous `DatabaseSync` surface. The `#db` import map and the
  drizzle/bun-sqlite adapter are red herrings at this SHA (see Context).
- **In-memory-first means no cross-reload durability until the OPFS follow-up.**
  Any P4 persistence criterion is reconciled to same-process read-back for the
  first cut (Q-2026-05-30-114 cross-references this).
- A parity/conformance case must pin the `DatabaseSync` surface (open `:memory:`,
  tolerate `PRAGMA journal_mode=WAL`, run a `CREATE TABLE` + `INSERT` + `SELECT`)
  against Node's real `node:sqlite` `DatabaseSync` where the harness can run it.

## Supersedence

This ADR **supersedes** two **DRAFTS** in `docs/opencode/decisions.md`
(Section A) — note those are drafts, NOT merged on-disk ADRs:

- **decisions.md draft ADR-0055** ("WASM-SQLite engine for the `#db` shim") — its
  engine recommendation (sql.js in-memory-first) is RATIFIED here, but its `#db`/
  `bun:sqlite` framing is CORRECTED to `node:sqlite` (the `#db` targets don't
  exist at the pinned SHA; nothing imports `#db`).
- **decisions.md draft ADR-0056** ("drizzle driver adapter for the WASM-SQLite
  `#db` shim") — its premise is VOID at this SHA: opencode uses
  `@effect/sql-sqlite-node` over `node:sqlite` `DatabaseSync`, NOT a drizzle
  driver. No drizzle subpath redirect is needed; the shim target is the
  `DatabaseSync` surface, not a drizzle driver constructor.

decisions.md is annotated to mark both drafts SUPERSEDED by this ADR.

## Reversibility

IRREVERSIBLE (reversibility rule 2 — a new external dependency, `sql.js`; and
rule 1 — registers a public `node:sqlite` builtin surface). Recorded as a
ratified ADR per the standing decision authority (ADR-0063/0064) with the Spike C
need verified. The in-memory-vs-OPFS scope split and the exact builtin module
path are the REVERSIBLE sub-decisions (Q-2026-05-31-301/302); the engine choice
and the synchronous-`DatabaseSync`-surface contract are the irreversible core.

## References

- Spike C verdict (`docs/opencode/README.md` §"Spike C — eager-database"); the
  vendored source at `tests/integration/fixtures/opencode/source` (full clone
  `/tmp/opencode-vendor`).
- ADR-0006 (shadow registry — source #4 `@sqlite.org/sqlite-wasm`; this ADR
  documents the first-cut divergence to `sql.js` and keeps the official build for
  the deferred OPFS path).
- ADR-0002 (cross-origin isolation mandatory — in-memory needs neither COI nor
  SAB; the deferred OPFS-sync follow-up will).
- ADR-0063/0064 (record-and-continue; verified-need dependency commitment is an
  inflection, not a stop).
- decisions.md DRAFTS ADR-0055 (engine) + ADR-0056 (drizzle adapter) — SUPERSEDED
  by this ADR.
- Q-2026-05-31-301 (in-memory-vs-OPFS persistence scope) + Q-2026-05-31-302
  (exact `node:sqlite` builtin module path) — the reversible sub-decisions.
- Q-2026-05-30-114 (opencode persistence reconciliation, cross-referenced).
