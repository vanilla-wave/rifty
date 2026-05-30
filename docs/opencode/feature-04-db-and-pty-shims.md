# Feature 04-db-and-pty-shims — #db -> WASM-SQLite + drizzle adapter, #pty -> throw-stub

> Part of the opencode-in-rifty facade effort. Feasibility phase P0/P2. Staged doc — NOT a ratified ADR.

## Summary

Make the opencode server's static import graph RESOLVE and BUILD inside rifty by replacing the two native-only specifiers it touches. The seam-map de-risk confirms `#db` is on the static import graph the moment `HttpApiApp.createRoutes` is loaded (server.ts → routes → session/session.ts → @/storage/db → `#db` → on rifty's `node` condition → db.node.ts → `node:sqlite`), so a resolvable `#db` target is MANDATORY for first light (P0 graph-load / P2 layer-build), not just for P4 storage. `#pty` is lazy (`const pty = lazy(() => import("#pty"))`), so it only needs a throw-on-create stub and never crashes at import.

This feature delivers TWO tiers, decoupled on purpose:

- **(A) a resolve-only tier** that makes both specifiers resolvable so the graph loads and trivial routes (P3) boot — REVERSIBLE: register `node:sqlite`/`bun:sqlite` plus the `drizzle-orm/*-sqlite` migrator subpaths as throw-on-USE builtins, and provide a `#pty` throw-on-create shim;
- **(B) a real WASM-SQLite + drizzle adapter** behind `#db` for P4 (session create + storage reads/writes) — IRREVERSIBLE because it introduces a NEW external dependency (sql.js or wa-sqlite) and a drizzle SQLite driver adapter. Tier B is surfaced for ADR ratification with a recommended option, NOT picked unilaterally.

The intercept lives at the resolver builtin registry + shadow-registry override table; rifty today has NO bare-builtin intercept for sqlite and NO per-package `#`-condition remap, both of which this feature adds as data-table entries plus one builtin factory.

## Decisions (classified)

### D04.1 — WASM-SQLite engine behind `#db`

- **Question:** Which WASM-SQLite engine backs the real `#db` `init(path)` for P4 (sql.js vs wa-sqlite vs absurd-sql)?
- **Classification:** IRREVERSIBLE

> **WARNING — IRREVERSIBLE / NEEDS RATIFICATION:** introduces a NEW external dependency (the WASM-SQLite engine). Do NOT write Tier-B code until the ADR is ratified.

- **Chosen:** **RECOMMENDED — awaiting ratification:** sql.js (Emscripten build of SQLite, pure-WASM, sync API). It is a single `.wasm` + JS glue with a fully synchronous, in-memory `Database` whose `.export()` yields a `Uint8Array` of the file image — which maps cleanly onto opencode's db.node.ts `init(path)` contract that expects to hand drizzle a synchronous statement-prepare surface, and persists trivially by writing the exported image to a VFS file. For first-light P4 the recommended persistence is IN-MEMORY (no VFS write) to remove a moving part; a follow-up promotes export-to-VFS.
- **Alternatives:**
  - **wa-sqlite:** richer (supports async VFS backends, OPFS persistence, can stream to storage) but its API is async and its drizzle integration is less standard, forcing a custom async driver and risking Effect-side assumptions of sync prepare; heavier to wire for first light.
  - **absurd-sql:** IndexedDB-block-VFS persistence layered on sql.js — solves durable persistence elegantly but adds a second dep and a Worker+SharedArrayBuffer requirement (cross-origin-isolation), which collides with rifty's SW realm constraints.
  - **Doing nothing / pure-JS SQLite reimplementation:** rejected (months of work, correctness risk vs drizzle's SQL dialect expectations).
- **Trade-offs:**
  - sql.js: + sync API matches the node:sqlite/bun:sqlite shape drizzle's sqlite drivers assume, + smallest blast radius, + `export()`→`Uint8Array`→VFS is a clean persistence story; − whole DB lives in memory, so large stores cost RAM and persistence is coarse-grained (rewrite whole image).
  - wa-sqlite: + incremental/async persistence, OPFS; − async impedance mismatch with drizzle sync sqlite driver, more adapter code, COI requirement.
  - absurd-sql: + durable; − extra dep + COI/Worker requirement.
  - Per reversibility rule 2 ANY of these is a NEW external dep = IRREVERSIBLE; the choice also shapes the drizzle adapter surface (next decision), so it must be ratified before code.
- **Reversibility justification:** Reversibility checklist rule 2: introduces a NEW external dependency (the WASM-SQLite engine). Also rule 4: a real adapter + persistence path will exceed 100 lines across the shadow-registry shim file and the `#db` override target. Two independent triggers → IRREVERSIBLE.
- **Proposed ADR:** ADR-00NN: WASM-SQLite engine for the opencode `#db` shim (sql.js, in-memory first, export-to-VFS later)

### D04.2 — drizzle driver adapter surface

- **Question:** What drizzle driver surface does the `#db` shim expose so opencode's drizzle queries (eq/and/desc over SessionTable/PartTable) run unchanged against the WASM engine?
- **Classification:** IRREVERSIBLE

> **WARNING — IRREVERSIBLE / NEEDS RATIFICATION:** drizzle-orm/sql-js (or sqlite-proxy) is effectively a new dependency surface pulled into the install/override graph; sets the cross-shim contract. Ratify alongside the engine ADR before writing Tier-B code.

- **Chosen:** **RECOMMENDED — awaiting ratification:** back the shim's exported `init(path)` with drizzle's official `drizzle-orm/sql-js` driver (it exists precisely for sql.js Database instances) and keep opencode's `export * from "drizzle-orm"` core (the eq/and/desc query builders) UNTOUCHED — only the driver constructor and the `migrate` entrypoint are redirected. The shim's `init` returns the same shape db.node.ts returns: `{ db: drizzle(sqljsDatabase, { schema }), client: sqljsDatabase }`, plus a no-op-or-real `migrate` that applies the drizzle-kit SQL migration files opencode ships. Concretely: intercept the bare specifiers `drizzle-orm/bun-sqlite`, `drizzle-orm/node-sqlite`, and `drizzle-orm/bun-sqlite/migrator` (the RUNTIME migrator import in db.ts per de-risk) and remap them — via shadow-registry override + VFS overlay file — to a thin module that re-exports drizzle-orm/sql-js's `drizzle` and a sql.js-backed `migrate`.
- **Alternatives:**
  - **drizzle-orm/sqlite-proxy:** driver-agnostic; you supply a `(sql, params, method) => rows` callback. More portable across engines (would also fit wa-sqlite) but you hand-roll result-shape mapping (rows vs run vs get) and risk subtle dialect/return-shape bugs vs the SessionTable schema.
  - **Hand-written drizzle-compatible Database (no drizzle driver):** rejected — re-implements drizzle's prepare/all/get/run contract, high correctness risk against opencode's exact queries.
  - **Override `#db` wholesale to a bespoke storage module that bypasses drizzle:** rejected — opencode's session.ts imports `{ Database } from "@/storage/db"` and uses drizzle query builders directly in handlers, so the drizzle surface must remain real.
- **Trade-offs:**
  - sql-js driver: + officially maintained, matches the chosen engine, smallest adapter; − hard-couples the adapter to sql.js (changing engine later means re-touching the adapter).
  - sqlite-proxy: + engine-portable; − more glue + result-shape risk.
  - The decision is downstream of the engine choice and equally IRREVERSIBLE (it sets the cross-shim contract and pulls drizzle's sql-js subpath into the install graph).
  - Migration nuance: opencode's `migrate()` runs drizzle-kit SQL files at first DB touch; on an empty in-memory store this is a fresh CREATE TABLE run (safe), unlike the CLI's yargs JSON→SQLite migration which does NOT self-skip (do not boot the CLI).
- **Reversibility justification:** Rule 2: drizzle-orm/sql-js (or sqlite-proxy) is effectively a new dependency surface pulled into the install/override graph. Rule 4: the remap touches the shadow-registry table + a new overlay source file + the `#db` target, >2 files. → IRREVERSIBLE; ratify alongside the engine ADR.
- **Proposed ADR:** ADR-00NN: drizzle driver adapter surface for the WASM-SQLite `#db` shim

### D04.3 — Location of the bare-specifier intercept

- **Question:** Where does the bare-specifier intercept for `node:sqlite` / `bun:sqlite` / `drizzle-orm/*-sqlite` live, given rifty has no sqlite builtin and no `#`-condition remap today?
- **Classification:** REVERSIBLE
- **Chosen:** Register `node:sqlite` and `bun:sqlite` as THROW-ON-USE builtins via `registerBuiltin('sqlite', factory)` / a `bun:sqlite` registry entry in `packages/runtime-js/src/builtins/index.ts` — the factory returns an object whose `DatabaseSync`/`Database` constructors throw `NotImplementedError('sqlite.native','use the WASM #db shim')`. This makes the specifier RESOLVE (so the static graph loads — fixing the MODULE_NOT_FOUND at resolver.ts:42-49) while still loud-throwing if anything actually constructs a native DB. The real DB path is reached through the `#db` override (the WASM tier), NOT through these builtins, because rifty picks db.node.ts via the `node` condition and we instead redirect `#db` itself at the shadow-registry layer. For the drizzle sqlite subpaths, add shadow-registry overlay entries pointing at a sql.js-backed shim source file. This split keeps tier A (resolvability) independent of tier B (real engine).
- **Alternatives:**
  - **(a)** Add a `bun` condition to resolver.ts CONDITIONS so `#db` picks db.bun.ts: rejected — that touches global resolution semantics for ALL packages (broad blast radius) and still lands on `bun:sqlite`.
  - **(b)** Per-package `#`-condition remap engine in the resolver: heavier, not needed since shadow-registry overlay can replace db.node.ts/db.bun.ts targets directly.
  - **(c)** Only overlay `#db` and never register the builtins: insufficient — `drizzle-orm/bun-sqlite/migrator` and type-only db.bun.ts paths can still pull `bun:sqlite` onto the graph; a resolvable throw-stub builtin is the safety net.
- **Trade-offs:** Builtin throw-stub: + tiny, additive, single file (builtins/index.ts), no public-API change, no new dep → comfortably REVERSIBLE; + matches existing pattern (null-net-stubs/misc-stubs register throwing-or-noop modules); − two more registry names to maintain. The decision is genuinely reversible because reverting is deleting two `registerBuiltin` lines and an overlay entry (<100 lines, ≤2 files in the resolvable tier).
- **Reversibility justification:** Rule 1: no cross-package public API change (`registerBuiltin` is the existing extension point; the names are internal registry keys). Rule 2: no new dependency in THIS tier (throw-stubs are zero-dep). Rule 3: no ADR conflict. Rule 4: ≤2 files, <100 lines. All no → REVERSIBLE.
- **Open question:** Q-2026-05-30-041

### D04.4 — `#pty` shim behavior and throw timing

- **Question:** What does the `#pty` shim do and when does it throw?
- **Classification:** REVERSIBLE
- **Chosen:** Provide a `#pty` shim module that exports the same surface as pty.node.ts/pty.bun.ts but whose session-create entrypoint throws `NotImplementedError('pty.session','interactive PTY is out of scope in the browser facade')`. Because `@/pty` uses `const pty = lazy(() => import("#pty"))` and only resolves the native target inside `create()` at session time (per de-risk), the shim need NOT throw at import — importing it must succeed (so the route layer builds), and only an actual PTY session-create call throws. Implement as a shadow-registry overlay source file targeted by a `#pty` remap, OR (simpler) since `#pty` is a package-internal import resolved by resolver.ts:61-72 against opencode's package.json imports map, overlay the db.node.ts-equivalent pty.node.ts target file in the VFS with the throw-stub source. Provisional: overlay pty.node.ts (rifty picks the `node` condition) with a throw-on-create source.
- **Alternatives:**
  - **(a)** Register a global throw at import of `#pty`: rejected — would crash P2 layer-build because the route builder statically imports the `@/pty` module (the lazy wrapper) even though it does not call `create()`.
  - **(b)** Map `#pty` to a fully functional xterm-style emulator: out of scope and collides with the PTY hard blocker.
  - **(c)** Leave `#pty` unresolved: rejected — MODULE_NOT_FOUND at graph load.
- **Trade-offs:** Throw-on-create overlay: + matches the documented PTY hard blocker (design TO it, not around it), + lets the server boot and serve non-PTY routes, + zero new dep; − a PTY session request returns a thrown error rather than a graceful 4xx (acceptable for the facade; the ceiling marker feature 09 documents this). Reverting is deleting one overlay entry → REVERSIBLE.
- **Reversibility justification:** Rule 1: no cross-package API change (VFS overlay data + existing resolver path). Rule 2: no new dep. Rule 3: aligns with the PTY hard blocker, no ADR conflict. Rule 4: 1 overlay file, <100 lines. → REVERSIBLE.
- **Open question:** Q-2026-05-30-042

### D04.5 — First-light persistence for `#db`

- **Question:** First-light persistence for `#db`: in-memory vs export-to-VFS file?
- **Classification:** REVERSIBLE
- **Chosen:** In-memory for P4 first light (sql.js Database with no backing file write), then promote to export-to-VFS (`db.export()` → write `Uint8Array` to a VFS path on a debounce/flush) as a follow-up. Note: the feasibility doc's original 'JSON-over-VFS' storage plan is INVALIDATED by the de-risk — opencode's data layer is drizzle-on-SQLite, not JSON, so persistence must be WASM-SQLite-image-over-VFS, not JSON-over-VFS. Mark the storage layer accordingly.
- **Alternatives:**
  - **Export-to-VFS from day one:** more realistic durability but adds flush-timing, concurrency, and read-on-boot logic before first light is even proven — premature.
  - **OPFS/IndexedDB via absurd-sql/wa-sqlite:** durable but pulls the heavier engine + COI requirement (see engine ADR).
- **Trade-offs:** In-memory: + simplest path to a green P4, + no flush/concurrency bugs masking the real goal (prove session create + 1 LLM round-trip); − data evaporates on reload. Export-to-VFS later: + durable, + reuses rifty FsSync; − needs flush policy. Reverting the in-memory choice is changing the `init()` body (<100 lines, 1 file in the shim) → REVERSIBLE, but it rides on the IRREVERSIBLE engine choice.
- **Reversibility justification:** Rule 1-3: no. Rule 4: confined to the `#db` shim source (1 file, <100 lines). → REVERSIBLE. (The engine that makes either option possible is the IRREVERSIBLE part, decided above.)
- **Open question:** Q-2026-05-30-043

## Interface contract

Resolver builtin registry (`packages/runtime-js/src/builtins/index.ts`) — additive registrations, no signature change:

```ts
registerBuiltin('sqlite', () => ({ DatabaseSync: class { constructor(){ throw new NotImplementedError('sqlite.native','use the WASM #db shim') } } }))
registerBuiltin('bun:sqlite', () => ({ Database: class { constructor(){ throw new NotImplementedError('sqlite.native','use the WASM #db shim') } } }))
// resolver.ts:40-51 routes both `node:sqlite` (slice 'node:') and the bare `bun:sqlite`
// through isBuiltinSpecifier(); these names make them RESOLVE instead of MODULE_NOT_FOUND.
```

Shadow-registry data tables (`tools/shadow-registry/src/index.ts`) — additive, same `OverrideMap` / `Record<string,string>` shapes already exported:

```ts
// VFS overlay (like esbuildShimFiles/rollupShimFiles): replace the #db node-condition
// target + drizzle sqlite subpaths + #pty node-condition target.
export const opencodeShimFiles: Record<string,string> = {
  '<opencode>/src/storage/db.node.ts': WASM_SQLITE_INIT_SOURCE,        // exports init(path): { db: drizzle(sqljs, {schema}), client }, + migrate
  '<opencode>/node_modules/drizzle-orm/bun-sqlite/migrator/index.js': SQLJS_MIGRATOR_SHIM,
  '<opencode>/src/pty/pty.node.ts': PTY_THROW_ON_CREATE_SOURCE,        // export create(){ throw NotImplementedError('pty.session', ...) }
}
// WASM_SQLITE_INIT_SOURCE re-exports drizzle-orm/sql-js's drizzle + sql.js Database;
// THIS is the new-dependency surface (IRREVERSIBLE tier B).
```

`#db` `init(path)` contract (must match opencode db.node.ts so session.ts's `{ Database } from "@/storage/db"` works unchanged):

```ts
init(dbPath: string): { db: DrizzleSqlJsDatabase<typeof schema>; client: SqlJsDatabase }  // sync; in-memory first light
migrate(db, { migrationsFolder }): void | Promise<void>   // applies opencode's drizzle-kit CREATE TABLE SQL on the fresh store
```

No change to `PortHandler`, `IncomingMessage`, `ServerResponse` (those are feature 05's `ServerResponse` 'drain'/pipe adapter). This feature touches ONLY module resolution + the two specifier targets.

## Affected packages & seams

**Affected packages:**

- `@rifty/runtime-js` (builtins/index.ts — resolvable throw-stub tier A)
- `@rifty/shadow-registry` (tools/shadow-registry — opencode overlay + WASM-SQLite/drizzle shim source, tier B)
- `@rifty/npm-client` (overrides.ts consumes shadow-registry bakedOverrides for the drizzle sqlite-subpath remap; no logic change beyond a data entry)

**Seam anchors:**

- `packages/runtime-js/src/module-loader/resolver.ts:40-51` (builtin specifier intercept — where node:sqlite/bun:sqlite currently throw MODULE_NOT_FOUND; tier-A throw-stubs make them resolve)
- `packages/runtime-js/src/module-loader/resolver.ts:61-72` (#db/#pty are #-imports resolved against opencode package.json imports map)
- `packages/runtime-js/src/module-loader/resolver.ts:231-236` (CONDITIONS = node,default,import,require; NO 'bun' → #db/#pty pick the node-condition targets db.node.ts/pty.node.ts, which is what we overlay)
- `packages/runtime-js/src/builtins/index.ts:59-106` (registerBuiltin registration block — add 'sqlite' and 'bun:sqlite' throw-stubs here, mirroring null-net-stubs/misc-stubs pattern)
- `packages/runtime-js/src/builtins/child_process.ts:24` (NotImplementedError import from @rifty/io — same throw helper for the stubs)
- `tools/shadow-registry/src/index.ts:36-39` (bakedOverrides — add drizzle-orm/*-sqlite subpath remap entry)
- `tools/shadow-registry/src/index.ts:158-161` (esbuildShimFiles pattern — model opencodeShimFiles VFS overlay on this)
- `tools/shadow-registry/src/index.ts:221-223` (rollupShimFiles pattern — second precedent for a native-binding VFS overlay)
- `packages/net/src/http/response.ts:53-65` (pull/pendingPulls — NOT changed here; cited only to confirm the #db work is orthogonal to the response streaming adapter owned by feature 05)

## Dependencies

**Depends on:**

- 01-load-opencode-into-vfs
- 02-ts-on-import-graph
- 03-conditional-imports-and-bun-sqlite-intercept

**Blocker proximity:** CLOSEST to the 'Native SQLite as-is' hard blocker and adjacent to the 'PTY interactive sessions' hard blocker — this feature IS the designed crossing of both, staying on the feasible side by:

- **(a)** never running native sqlite: node:sqlite/bun:sqlite are throw-on-USE stubs and the real path is a WASM engine behind `#db`, so no native dlopen ever occurs;
- **(b)** treating PTY as design-TO-the-blocker: `#pty` resolves and imports (so the layer builds) but throws at session-create, exactly matching 'Dynamic import => stub to throw on session create' in the blocker list.

The one residual risk that could push toward infeasible is if drizzle's sql-js driver or the migrator pulls a native binding transitively at IMPORT (not just at construction) — the de-risk shows the connection is lazy (built inside `init()`/`Client()` at first query, not at module eval), and the migrator is the only runtime drizzle subpath on the static graph, which the overlay replaces; so the feasible-side guarantee holds as long as the overlay covers `drizzle-orm/bun-sqlite`, `drizzle-orm/node-sqlite`, AND `drizzle-orm/bun-sqlite/migrator`. Process-spawn and ripgrep blockers are untouched by this feature (owned by feature 09's ceiling marker).

## Test strategy

Levels: integration (primary) + parity (where Node-comparable) + unit (resolver/registry).

1. **UNIT (resolver/registry):** assert `node:sqlite` and `bun:sqlite` now RESOLVE to `kind:'builtin'` (no MODULE_NOT_FOUND at resolver.ts:42-49), and that `loadBuiltin('node:sqlite').DatabaseSync` constructor THROWS `NotImplementedError` — pins tier A's resolve-vs-use boundary.
2. **INTEGRATION (graph-load, P0/P2 gate):** fork `tests/integration/fixtures/real-vite-smoke.ts` into an opencode headless harness — memory VFS, install/vendor opencode, overlay `opencodeShimFiles`, `createModuleLoader(fsSync,{cwd:ROOT})`, then `loader.import` the createRoutes module graph (server/routes/instance/httpapi/server.ts). Assert it loads WITHOUT MODULE_NOT_FOUND — directly verifies the de-risk chain (session.ts → @/storage/db → #db → node:sqlite) is now resolvable. This is the make-or-break test.
3. **INTEGRATION (P4 storage round-trip):** with the real WASM tier, run a sql.js-backed `init(path)`, drizzle CREATE TABLE migrate, then an insert+select over a SessionTable-shaped schema; assert rows return in drizzle's expected shape. Runs sandbox-disabled (live npm for sql.js/drizzle).
4. **PARITY (gold standard, where applicable):** a parity case comparing a small `drizzle-orm/sql-js` query (insert/select/eq) run under rifty's loader vs Node with the same sql.js driver — diff stdout to catch result-shape divergence in the adapter. Parity is the project gold standard for Node-compatible behavior; the SQL itself is engine-not-Node-specific, so the parity target is the drizzle result shape, not SQLite internals.
5. **NEGATIVE (#pty ceiling):** assert importing `#pty` (the lazy wrapper module) SUCCEEDS at load, and that calling the pty `create()` entrypoint THROWS `NotImplementedError('pty.session',...)` — encodes the PTY hard-blocker boundary that feature 09 documents.

## Implementation plan (test-first)

1. **T1 — UNIT — Tier A throw-on-USE builtins.** Make `node:sqlite` and `bun:sqlite` RESOLVE to `kind:'builtin'` (not MODULE_NOT_FOUND) while still loud-throwing on actual DB construction. Add `builtins/sqlite-stub.ts` and two `registerBuiltin` lines in `builtins/index.ts`. Pins the resolve-vs-use boundary: factory returns OK, constructor throws. UNIT (not parity) because this is rifty-internal resolver/registry wiring with no Node-comparable behavior — Node would import the real native module.
   - **FAILING test first:** In `packages/runtime-js/src/builtins/sqlite-stub.test.ts`: `test('node:sqlite and bun:sqlite resolve to builtin then throw on construct')` — after importing `builtins/index.ts`: (a) `expect(isBuiltinSpecifier('node:sqlite')).toBe(true)` and `isBuiltinSpecifier('bun:sqlite')===true`; (b) `expect(loadBuiltin('node:sqlite'))` is a non-null object exposing `DatabaseSync` (factory does NOT throw); (c) `expect(() => new (loadBuiltin('node:sqlite') as any).DatabaseSync(':memory:')).toThrow(NotImplementedError)` with `.feature==='sqlite.native'`; (d) same for `new bunSqliteModule.Database()`.
   - **Files:** `packages/runtime-js/src/builtins/sqlite-stub.ts`, `packages/runtime-js/src/builtins/sqlite-stub.test.ts`, `packages/runtime-js/src/builtins/index.ts`
   - **Test kind:** unit

2. **T2 — UNIT — resolver-level resolvability assertion.** Assert the bare `bun:sqlite` specifier (no node: prefix) and `node:sqlite` both resolve through `createResolver` to a `ResolvedModule` of `kind:'builtin'` instead of throwing `ModuleLoadError` MODULE_NOT_FOUND at resolver.ts:42-49. Guards the de-risk chain's import-time fatal (the exact failure feature 03 hands off). UNIT because it exercises `createResolver(vfs).resolve` directly — a structural rifty invariant, not Node-comparable.
   - **FAILING test first:** In `packages/runtime-js/src/module-loader/resolver.sqlite.test.ts`: `test('bun:sqlite and node:sqlite resolve as builtin, not MODULE_NOT_FOUND')` — build a memory vfs + `createResolver(vfs)`; `expect(resolver.resolve('bun:sqlite',{fromFile:'/x.js',esm:false}).kind).toBe('builtin')`; `expect(resolver.resolve('node:sqlite',{fromFile:'/x.js',esm:false}).kind).toBe('builtin')`; and `expect(() => resolver.resolve('node:nonsense-builtin',{...})).toThrow(/MODULE_NOT_FOUND/)` to prove the registry gate still rejects unknowns.
   - **Files:** `packages/runtime-js/src/module-loader/resolver.sqlite.test.ts`
   - **Test kind:** unit

3. **T3 — UNIT — `#pty` throw-on-create overlay source.** Importing the pty module must SUCCEED (so the `@/pty` `lazy()` wrapper builds and the route layer constructs) and only calling `create()` throws `NotImplementedError('pty.session',...)`. Add `PTY_THROW_ON_CREATE_SOURCE` to a new `tools/shadow-registry/src/opencode-shims.ts` and key it in `opencodeShimFiles`. Encodes the PTY hard-blocker boundary (design TO it). REVERSIBLE — no new dep. UNIT because the shim source is evaluated in isolation; no Node equivalent (Node loads native node-pty).
   - **FAILING test first:** In `tools/shadow-registry/src/opencode-shims.test.ts`: `test('#pty overlay imports clean and throws only on create()')` — eval the `PTY_THROW_ON_CREATE_SOURCE` module (via a minimal `loader.import` over a memory vfs that has the overlay written, or a direct dynamic import of the source string); expect import to resolve WITHOUT throwing; then `expect(() => mod.create()).toThrow(NotImplementedError)` with `.feature==='pty.session'`. Assert `opencodeShimFiles` has the pty.node.ts key present.
   - **Files:** `tools/shadow-registry/src/opencode-shims.ts`, `tools/shadow-registry/src/opencode-shims.test.ts`, `tools/shadow-registry/src/index.ts`
   - **Test kind:** unit

4. **T4 — HARNESS — P0/P2 MAKE-OR-BREAK graph-load gate.** Fork `tests/integration/fixtures/real-vite-smoke.ts` into `real-opencode-graph-smoke.ts` — memory VFS, install/vendor opencode (from feature 01), overlay `opencodeShimFiles` (#pty stub + tier-A sqlite builtins registered), `createModuleLoader(fsSync,{cwd:ROOT})`, `__setCreateRequireImpl(loader)`, then `loader.import` the createRoutes module graph (server/server → routes → session.ts → @/storage/db → #db → node:sqlite). Asserts the graph loads with NO MODULE_NOT_FOUND. HARNESS (standalone tsx, sandbox-disabled for live npm) because it replaces `globalThis.process` and needs network, exactly like real-vite-smoke — incompatible with in-process vitest. This is the test that proves de-risk unknown #1 (does createRoutes statically import the DB layer) on the resolvable tier.
   - **FAILING test first:** `tests/integration/opencode-graph-load.opt-in.test.ts` spawns the fixture and asserts stdout contains `'RIFTY_OPENCODE_GRAPH_OK'` and exit code 0; the fixture itself prints that token ONLY after `loader.import` of the createRoutes entry resolves and explicitly prints FAIL + nonzero exit if any `ModuleLoadError('MODULE_NOT_FOUND')` is caught (especially for node:sqlite / bun:sqlite / #db / #pty). First run (before T1+T3 wiring) must FAIL with MODULE_NOT_FOUND on bun:sqlite.
   - **Files:** `tests/integration/fixtures/real-opencode-graph-smoke.ts`, `tests/integration/opencode-graph-load.opt-in.test.ts`
   - **Test kind:** harness

5. **T5 — INTEGRATION — GATED (ADR engine + driver) — WASM-SQLite `#db` init.** Implement `WASM_SQLITE_INIT_SOURCE` in `opencode-shims.ts` — sql.js-backed `init(path)` returning `{ db: drizzle(client,{schema}), client }` (in-memory, Q-2026-05-30-004) and a `migrate()` that applies drizzle-kit CREATE TABLE SQL on the fresh store. INTEGRATION (sandbox-disabled, live npm for sql.js + drizzle-orm/sql-js) because it requires the real engine + real drizzle driver running under rifty's loader; cannot be a pure unit.
   - **FAILING test first:** In `tests/integration/opencode-db-storage.opt-in.test.ts` (spawning a fixture): run the shim's `init(':memory:')`, call `migrate()` with a SessionTable-shaped schema, then drizzle insert one session row and select it back with `eq()/and()/desc()`. Assert the returned row matches the inserted shape (id, fields) — i.e. drizzle's result shape is correct over the sql.js engine. First run (no Tier-B code) FAILS because `WASM_SQLITE_INIT_SOURCE` is absent/throws.
   - **Files:** `tools/shadow-registry/src/opencode-shims.ts`, `tests/integration/fixtures/real-opencode-db-smoke.ts`, `tests/integration/opencode-db-storage.opt-in.test.ts`
   - **Test kind:** integration

6. **T6 — PARITY — GATED (ADR driver) — drizzle result-shape parity.** Parity gold-standard for the drizzle result-shape contract: run an identical small `drizzle-orm/sql-js` insert+select+eq program under (a) rifty's module loader and (b) Node with the same sql.js driver, diff stdout. The SQL is engine-not-Node-specific, so the parity target is drizzle's RESULT SHAPE through the adapter (rows vs run vs get), catching divergence the integration insert/select cannot. PARITY per CLAUDE.md gold-standard rule for Node-comparable behavior.
   - **FAILING test first:** Add a parity case (parity runner): program does `drizzle(sqljs).insert(t).values({...})`; then `.select().from(t).where(eq(t.id,'a'))`; `JSON.stringify` the rows to stdout. Run under Node and under rifty's loader; the parity runner diffs stdout and FAILS on any field/shape/ordering difference. First run FAILS until the adapter (T5) produces Node-identical shapes.
   - **Files:** `tests/parity/cases/drizzle-sqljs-shape.parity.ts`, `tests/parity/cases/drizzle-sqljs-shape.expected`
   - **Test kind:** parity

7. **T7 — INTEGRATION — GATED (both ADRs) — drizzle subpath remap + migrator overlay.** Add the `drizzle-orm/*-sqlite` subpath redirect (`bakedOverrides` entry + `SQLJS_MIGRATOR_SHIM` overlay for `drizzle-orm/bun-sqlite/migrator`) so the migrator — the only runtime drizzle subpath on the static graph — never pulls `bun:sqlite` at eval. Confirm whether the package-level override engine accepts a subpath key or whether a VFS-overlay of the subpath file is required (see risks). INTEGRATION because it must be proven against the real installed drizzle tree under the loader.
   - **FAILING test first:** Extend `tests/integration/opencode-graph-load.opt-in.test.ts` (or a sibling) so the graph-load harness imports a module that statically requires `drizzle-orm/bun-sqlite/migrator`; assert the import resolves to the `SQLJS_MIGRATOR_SHIM` (no bun:sqlite MODULE_NOT_FOUND, no native-binding eval). Negative arm: with the remap removed, assert the import trips bun:sqlite construction/MODULE-eval — proving the remap is load-bearing.
   - **Files:** `tools/shadow-registry/src/index.ts`, `tools/shadow-registry/src/opencode-shims.ts`, `tests/integration/opencode-graph-load.opt-in.test.ts`
   - **Test kind:** integration

### Scaffolding sketch

#### Tier A — resolvable throw-on-USE builtins (REVERSIBLE, ship without gate)

`packages/runtime-js/src/builtins/sqlite-stub.ts` (NEW)

```ts
import { NotImplementedError } from '@rifty/io';
// CJS-shape namespace. The factory body must NOT throw (loadBuiltinOrThrow
// runs the factory eagerly at import — loader.ts:44-49); only construction throws.
class ThrowingDatabase {
  constructor(_path?: string, _opts?: unknown) {
    throw new NotImplementedError('sqlite.native', 'use the WASM #db shim');
  }
}
export const nodeSqliteModule = { DatabaseSync: ThrowingDatabase };   // node:sqlite shape
export const bunSqliteModule  = { Database:     ThrowingDatabase };   // bun:sqlite shape
```

`packages/runtime-js/src/builtins/index.ts` (EDIT — additive, mirrors L93-106 stub block)

```ts
import { bunSqliteModule, nodeSqliteModule } from './sqlite-stub.ts';
registerBuiltin('sqlite', () => nodeSqliteModule);       // resolves `node:sqlite`
registerBuiltin('bun:sqlite', () => bunSqliteModule);    // resolves bare `bun:sqlite`
```

resolver.ts:40-42 already routes both through `isBuiltinSpecifier()`; these two names flip MODULE_NOT_FOUND → `kind:'builtin'`.

#### Tier B — WASM-SQLite + drizzle `#db` target (IRREVERSIBLE — GATED, do NOT write before ADR)

`tools/shadow-registry/src/opencode-shims.ts` (NEW — same `Record<string,string>` shape as esbuildShimFiles)

```ts
// VFS-overlay sources, keyed by post-install VFS path (model on esbuildShimFiles L158-161).
// <opencode> root path TBD by feature 01; placeholder shown.
export const opencodeShimFiles: Record<string, string> = {
  '/workspace/<opencode>/src/storage/db.node.ts': WASM_SQLITE_INIT_SOURCE,
  '/workspace/<opencode>/node_modules/drizzle-orm/bun-sqlite/migrator/index.js': SQLJS_MIGRATOR_SHIM,
  '/workspace/<opencode>/src/pty/pty.node.ts': PTY_THROW_ON_CREATE_SOURCE,   // tier-A-adjacent, ships now
};
```

`WASM_SQLITE_INIT_SOURCE` (the new-dependency surface — sql.js + drizzle-orm/sql-js):

```js
// init(path): same shape db.node.ts returns so session.ts `{ Database } from '@/storage/db'` is unchanged.
export function init(dbPath) {
  const SQL = /* sql.js */; const client = new SQL.Database();   // in-memory first light (Q-2026-05-30-004)
  return { db: drizzle(client, { schema }), client };            // drizzle-orm/sql-js driver
}
export function migrate(db, { migrationsFolder }) { /* apply drizzle-kit CREATE TABLE SQL on fresh store */ }
```

`PTY_THROW_ON_CREATE_SOURCE` (REVERSIBLE — ships now, no dep):

```js
import { NotImplementedError } from '...';      // resolved via overlay's import map
export function create() { throw new NotImplementedError('pty.session','interactive PTY is out of scope in the browser facade'); }
// importing this module must SUCCEED (lazy() wrapper builds the route layer); only create() throws.
```

`tools/shadow-registry/src/index.ts` (EDIT — bakedOverrides L36-39 additive entry)

```ts
export const bakedOverrides: OverrideMap = {
  bcrypt: 'bcryptjs',
  // drizzle sqlite subpaths remapped at install so they never pull bun:sqlite/node:sqlite onto the graph:
  'drizzle-orm/bun-sqlite':  'drizzle-orm/sql-js',   // (exact remap key form TBD vs subpath-override engine)
  'drizzle-orm/node-sqlite': 'drizzle-orm/sql-js',
};
```

#### Harness (test infra, REVERSIBLE)

`tests/integration/fixtures/real-opencode-graph-smoke.ts` (NEW — fork of real-vite-smoke.ts)

```ts
// memory VFS → install/vendor opencode → overlay opencodeShimFiles → createModuleLoader(fsSync,{cwd:ROOT})
// → __setCreateRequireImpl(loader) → loader.import('<server/server entry>', ROOT)
// → prints RIFTY_OPENCODE_GRAPH_OK iff createRoutes graph loads with NO MODULE_NOT_FOUND.
```

### Risks

- **GATE:** Tier B (decisions #1 engine sql.js, #2 drizzle-orm/sql-js driver) is IRREVERSIBLE by reversibility rule 2 (new external dependency) — no Tier-B code (`WASM_SQLITE_INIT_SOURCE`, `SQLJS_MIGRATOR_SHIM`, the bakedOverrides drizzle remap, P4/parity tests) may be written until the two ADRs are ratified. Tier A + #pty stub + graph-load harness are REVERSIBLE and unblocked.
- `loadBuiltinOrThrow` (loader.ts:44-49) runs the factory eagerly at import time. The throw MUST live in the `DatabaseSync`/`Database` CONSTRUCTOR, not the factory body — a factory that throws would crash the graph load that Tier A is meant to enable. The unit test must assert factory-returns-OK / constructor-throws separately.
- Residual infeasibility risk: if `drizzle-orm/sql-js` OR the migrator subpath pulls a native binding at MODULE EVAL (not at construction), the overlay must cover ALL of `drizzle-orm/bun-sqlite`, `drizzle-orm/node-sqlite`, AND `drizzle-orm/bun-sqlite/migrator`. The graph-load harness (Task 2 / T4) is the make-or-break test that exposes any uncovered transitive native pull before Tier B work starts.
- `<opencode>` VFS root path in `opencodeShimFiles` keys is produced by feature 01 (load-opencode-into-vfs). Until that lands the keys are placeholders; this plan dependsOn 01/02/03 and the overlay keys must be reconciled with feature 01's actual install/vendor layout.
- drizzle sqlite-subpath remap is SUBPATH-level (`'drizzle-orm/bun-sqlite'`), but overrides.ts `resolveOverride` is PACKAGE-level only today. Whether `bakedOverrides` can carry a subpath key, or whether a VFS-overlay of the subpath file is needed instead, is itself a Tier-B design point to confirm during ADR drafting — do not assume the package-level override engine accepts a subpath key.
- In-memory first-light persistence (Q-2026-05-30-004) means session data evaporates on reload; export-to-VFS is a deferred follow-up. P4 acceptance must not assert durability across reloads.
- OQ id renumbering: design cites Q-2026-05-30-041/042/043 but the latest landed id is Q-2026-05-30-001; log these as Q-2026-05-30-002 (sqlite/bun:sqlite intercept), -003 (#pty throw-on-create), -004 (in-memory first-light) to avoid an id gap.

### Estimate

Tier A + #pty stub + graph-load harness (Tasks 1-4): ~3 evenings, UNBLOCKED. Tier B real WASM-SQLite + drizzle adapter (Tasks 5-7): ~4-5 evenings, BLOCKED until the two ADRs ratify. Total ~7-8 evenings.

### Ratification gate

BLOCKED for Tier B only. Two IRREVERSIBLE decisions need ratification before any Tier-B task starts:

1. **"ADR-00NN: WASM-SQLite engine for the opencode `#db` shim"** — recommended sql.js, in-memory first / export-to-VFS later (reversibility rule 2: new external dependency);
2. **"ADR-00NN: drizzle driver adapter surface for the WASM-SQLite `#db` shim"** — recommended `drizzle-orm/sql-js` driver + redirect of `drizzle-orm/bun-sqlite`, `drizzle-orm/node-sqlite`, `drizzle-orm/bun-sqlite/migrator` (rule 2 + rule 4).

Tasks 1-4 (Tier A throw-stubs, #pty throw-on-create overlay, graph-load harness) are REVERSIBLE and may proceed immediately, logged as Q-2026-05-30-002/003/004.
