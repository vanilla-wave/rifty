# ADR 0065: `node:sqlite` `DatabaseSync` WASM shim — sql.js, in-memory-first (P2 boot prerequisite)

Status: Accepted (supersedes decisions.md DRAFTS ADR-0055 + ADR-0056; opencode facade M12)
Date: 2026-05-31

> TL;DR: `node:sqlite` `DatabaseSync` is shimmed by synchronous in-memory `sql.js` WASM (OPFS persistence deferred), unblocking opencode's eager `Server.listen` boot

## Context

opencode (anomalyco/opencode, vendored at SHA `f401f01c05bead2fd0687004c912743d271e2b7b`, `tests/integration/fixtures/opencode/source`) does NOT lazily open its database. **Spike C** (static analysis; verdict in `docs/opencode/README.md`) verified the eager chain:

`Server.listen` (`server.ts:75`) → `Layer.buildWithMemoMap` (`:129`, eager full-DAG build) → `HttpApiApp.createRoutes` unconditionally provides `fenceLayer.pipe(Layer.provide(Database.defaultLayer))` (`httpapi/server.ts:193,195`). `fenceLayer`'s acquire runs `const { db } = yield* Database.Service` (`middleware/fence.ts:9-11`) at layer-build, forcing `Database.layer` (`@opencode-ai/core` `database.ts:21`): acquire runs `makeDatabase` (`PRAGMA journal_mode = WAL` + ~5 PRAGMAs) then `DatabaseMigration.apply(db)` (~24 migration files, real `CREATE TABLE`/`SELECT`/`INSERT` DDL in transactions) — all under `Effect.orDie`. `makeDatabase` → `sqlite.node.ts` runs `new DatabaseSync(filename, {open: true})` (`:151,156`) over a top-level `import … from "node:sqlite"` (`:1`).

So **booting `Server.listen` requires a WORKING `node:sqlite` `DatabaseSync`** that opens `:memory:`, no-ops `PRAGMA journal_mode=WAL`, and executes the migration DDL — before any request. A throw-on-USE stub is insufficient: the first `db.run` during migration dies the layer build. This is a **proven need** — opencode's own boot tests set `OPENCODE_DB=:memory:` (`test/preload.ts`) to provision real SQLite for the HTTP layer.

**Premise corrections from Spike C:**
- The `#db` import map (`package.json` `imports`) is **stale** — its targets (`src/storage/db.{node,bun}.ts`) don't exist at this SHA and nothing imports `#db`. Live target is `@opencode-ai/core/database`. Drafts ADR-0055/0056's `#db`/`bun:sqlite`-intercept framing is moot.
- rifty resolves under the **`node`** condition → relevant specifier is `node:sqlite` (Node ≥22 `DatabaseSync`), NOT `bun:sqlite`. Shim target is `@effect/sql-sqlite-node`'s `DatabaseSync` usage (effect@4.0.0-beta.66). (See Erratum re drizzle.)

Made under ADR-0063/0064 standing authority (verified-need dependency = inflection, not stop), Spike C need verified.

## Decision

- **D1 — Engine: `sql.js`** (pure-JS Emscripten SQLite, WASM, **synchronous** API, in-memory). Load-bearing property: `sql.js` exposes a fully synchronous `Database` (after one-time async WASM init), matching opencode's synchronous `DatabaseSync`/`@effect/sql-sqlite-node` usage and its `OPENCODE_DB=:memory:` boot path with no async-impedance mismatch.

- **D2 — In-memory first; OPFS persistence DEFERRED.** First cut is in-memory only. Cross-reload durability via `@sqlite.org/sqlite-wasm` + OPFS `SyncAccessHandle` is a follow-up (Q-2026-05-31-301), out of scope. opencode boots/serves with `:memory:`; durability is off the boot path.

- **D3 — Registered as a rifty `node:sqlite` builtin exposing a `DatabaseSync`-compatible synchronous surface.** Intercepts the `node:sqlite` specifier, presents a `DatabaseSync`-shaped object: constructor `(filename, {open}?)`, the `.exec`/`.prepare`/`.run`/`.all`/`.get`/`.close` methods actually called, tolerant/no-op `PRAGMA journal_mode=WAL`. Exact registration module path is reversible (Q-2026-05-31-302). No `bun:sqlite` interception, no drizzle driver redirect.

- **D4 — No silent stubs.** Methods not on the boot/first-light path that `sql.js` can't back stay directed `NotImplementedError` throws with a compat-matrix entry, never fake values. Migration DDL, opencode's PRAGMAs, and `:memory:` open MUST actually work.

### Why `sql.js` over `@sqlite.org/sqlite-wasm` for the first cut

ADR-0006's substitution ordering (source #4) names `@sqlite.org/sqlite-wasm`. Per ADR-0006 governance, this divergence is documented:

- The official build's ergonomic surface is async/OO (persistent variant needs OPFS + Worker). opencode's boot path is **synchronous** `DatabaseSync` over `:memory:`; `sql.js` provides exactly a synchronous `Database` (single `.wasm` + glue). Forcing the async build through a sync `DatabaseSync` facade would fight the boot API.
- `@sqlite.org/sqlite-wasm` is NOT abandoned — it is the **engine for the deferred OPFS-persistence follow-up** (D2 / Q-2026-05-31-301), where its OPFS `SyncAccessHandle` VFS fits. First cut = sync in-memory engine; persistence = durable OPFS engine. Keeps ADR-0006 source #4 in the trajectory.
- `wa-sqlite` / `absurd-sql` rejected for the first cut: async + COI/SharedArrayBuffer (wa-sqlite) or a second durable-VFS dependency (absurd-sql), both fighting the synchronous boot need.

### Relationship to ADR-0002 (cross-origin isolation / SharedArrayBuffer)

- **In-memory `sql.js` needs NEITHER COI NOR SAB** — self-contained WASM on its own linear memory. So this P2 boot prerequisite adds **no new COI/SAB dependency** beyond what ADR-0002 already mandates.
- The **deferred OPFS-persistence follow-up WILL interact with ADR-0002**: `@sqlite.org/sqlite-wasm` + OPFS `SyncAccessHandle` requires COI (sync access off main thread). That analysis belongs to Q-2026-05-31-301, not here.

## Consequences

- **WASM-SQLite re-cut from a P4 need to a P2 boot prerequisite** — must land before any server-boot smoke test (on the `Server.listen` layer-build path). PROJECT_PLAN.md M12 and `docs/opencode/README.md` reflect this.
- **New external dependency `sql.js`** (IRREVERSIBLE per reversibility rule 2 — hence this ADR). Persistence engine `@sqlite.org/sqlite-wasm` NOT added now (gated by Q-2026-05-31-301).
- **`bun:sqlite`-intercept framing corrected to `node:sqlite`** (rifty resolves under `node`). The `#db` import map is a red herring at this SHA (see Context; drizzle point corrected in Erratum).
- **In-memory-first → no cross-reload durability until the OPFS follow-up.** Any P4 persistence criterion reconciled to same-process read-back for the first cut (Q-2026-05-30-114 cross-refs this).
- A parity/conformance case must pin the `DatabaseSync` surface (open `:memory:`, tolerate `PRAGMA journal_mode=WAL`, run `CREATE TABLE` + `INSERT` + `SELECT`) against Node's real `node:sqlite` `DatabaseSync` where the harness can run it.

## Supersedence

Supersedes two **DRAFTS** in `docs/opencode/decisions.md` (Section A) — drafts, NOT merged on-disk ADRs:

- **decisions.md draft ADR-0055** ("WASM-SQLite engine for the `#db` shim") — engine recommendation (sql.js in-memory-first) RATIFIED here; its `#db`/`bun:sqlite` framing CORRECTED to `node:sqlite` (`#db` targets don't exist at the pinned SHA; nothing imports `#db`).
- **decisions.md draft ADR-0056** ("drizzle driver adapter for the WASM-SQLite `#db` shim") — premise VOID at this SHA: shim target is the `DatabaseSync` surface, not a drizzle driver constructor; no drizzle subpath redirect needed. (Drizzle point further corrected in Erratum.)

decisions.md is annotated to mark both drafts SUPERSEDED by this ADR.

## Reversibility

IRREVERSIBLE (rule 2 — new external dependency `sql.js`; rule 1 — registers a public `node:sqlite` builtin surface). Ratified per ADR-0063/0064 with Spike C need verified. The in-memory-vs-OPFS scope split and exact builtin module path are REVERSIBLE sub-decisions (Q-2026-05-31-301/302); the engine choice and synchronous-`DatabaseSync`-surface contract are the irreversible core.

## References

- Spike C verdict (`docs/opencode/README.md` §"Spike C — eager-database"); vendored source at `tests/integration/fixtures/opencode/source` (full clone `/tmp/opencode-vendor`).
- ADR-0006 (shadow registry — source #4 `@sqlite.org/sqlite-wasm`; this ADR documents the first-cut divergence to `sql.js`, keeps the official build for the deferred OPFS path).
- ADR-0002 (COI mandatory — in-memory needs neither COI nor SAB; the deferred OPFS-sync follow-up will).
- ADR-0063/0064 (record-and-continue; verified-need dependency = inflection, not stop).
- decisions.md DRAFTS ADR-0055 (engine) + ADR-0056 (drizzle adapter) — SUPERSEDED by this ADR.
- Q-2026-05-31-301 (in-memory-vs-OPFS persistence scope) + Q-2026-05-31-302 (exact `node:sqlite` builtin module path) — reversible sub-decisions.
- Q-2026-05-30-114 (opencode persistence reconciliation, cross-referenced).

## Erratum (2026-05-31)

This ADR is immutable; the following is a same-day factual correction that does NOT change the decision (shim target, engine, and synchronous-`DatabaseSync` contract all stand). It corrects two Context/Supersedence statements:

- **drizzle IS wired over `node:sqlite` `DatabaseSync` at the pinned SHA.** The Context premise correction ("relevant specifier is `node:sqlite` … NOT drizzle/bun-sqlite") and the Supersedence note (drizzle adapter "void"/"red herring") were wrong on the drizzle point: `drizzle-orm/node-sqlite` IS wired over the SAME `node:sqlite` `DatabaseSync` instance at SHA `f401f01`. Decision unchanged: shim target is still the `node:sqlite` `DatabaseSync` surface, still no drizzle subpath redirect (drizzle's `node-sqlite` driver consumes the very `DatabaseSync` this ADR ratifies). Practical consequence: **the shim must also satisfy drizzle's `DatabaseSync` usage** (`prepare(...).all/.get/.run`, `setReturnArrays`, `setReadBigInts`, `exec`), not just `@effect/sql-sqlite-node`'s — which it already does (same surface).

- **First-flow correctness rests on effect's `Client.SafeIntegers` `Context.Reference` defaulting to `false`.** Verified in effect@4.0.0-beta.66: `Client.SafeIntegers` is a `Context.Reference` with default `false`. The real `@effect/sql-sqlite-node` driver invokes `setReadBigInts(...)` PER-QUERY from that reference, so on the first flow it calls `setReadBigInts(false)` — the plain-`number` read path — NOT `setReadBigInts(true)`. So the shim boots opencode despite throwing a directed `NotImplementedError` on `setReadBigInts(true)`: the boot/first-flow path never requests BigInt reads. (Per finding #2, the `false` path is now non-silent on overflow — an INTEGER past `Number.MAX_SAFE_INTEGER` throws Node's `RangeError` / `ERR_OUT_OF_RANGE`, matching Node v24, rather than returning a truncated float.)
