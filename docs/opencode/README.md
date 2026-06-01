# M12 (proposed) — opencode server facade in rifty

> **STAGED PROPOSAL — partially shipped.** This is the lean current-state doc for
> the effort to run **anomalyco/opencode** (the Effect/Bun TypeScript *source*
> graph, not the published native `opencode-ai` npm package) inside rifty as a
> **no-tool-execution agent facade**. The full per-feature designs and the
> adversarial review that produced this plan were consolidated away (2026-05-31
> doc audit); their load-bearing content — what shipped, what is blocked, and the
> exact gate for each — is captured below. The detailed decision register with
> the full text of every ADR draft (ratified + deferred) lives in
> [`decisions.md`](decisions.md); the feasibility verdict in
> [`../opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md).

## Goal and verdict

Run opencode's Effect HTTP server headlessly in rifty: build its ~40 Effect
layers, serve trivial routes, create a session, and perform one LLM round-trip —
but **cannot** spawn processes, run a shell, drive native git/ripgrep, or open a
PTY. Feasibility verdict: **feasible-with-major-work (medium confidence)** — the
server is portable as a server facade up to a hard, browser/WASI-imposed
**tool-execution ceiling**. rifty already proved real express@4 + vite@5 run
in-process, so "big Node/Effect server" alone is not the blocker; tool execution
(spawn/PTY/native git/ripgrep) is the hard ceiling.

opencode is now **vendored** at a pinned SHA (see F01 below). Spike C has run
(static analysis against the vendored tree): its verdict **pulls WASM-SQLite
forward from P4 to a P2 boot prerequisite** — `Server.listen` builds the layer
DAG eagerly and a real `Database` (`node:sqlite` `DatabaseSync`) is opened +
migrated at layer-build, not lazily. The `node:sqlite` `DatabaseSync` shim
(ADR-0065, `sql.js` engine) is built, green, and **wired into the module loader**
as a `node:sqlite` builtin; the TS-on-import transform + resolver are wired for
the real graph. Both live gates are now **GREEN**: the **GRAPH-LOAD gate**
(F02-T9) resolves + evaluates the whole ~900-file server graph and exposes
`Server.listen`, and the **BOOT gate** (F06) then calls `Server.listen`
headless — the eager ~40-layer DAG builds, the real drizzle/sql.js layer runs the
PRAGMAs + ~24 migrations under `Effect.orDie`, and `/global/health` + `/doc`
return 200. A third gate, **DB-READ** (Phase 2), then proves the migrated schema
is queryable through a request: `GET /session` runs a real drizzle SELECT and
returns `200 []`. Spike C's eager-`Database` prediction is live-confirmed. See the
gate sections below for the exact evidence; the next gate is Phase 3 (create a
session + one LLM round-trip).

## What shipped (green)

Last full local verification on HEAD `490230a` (branch
`wire-opencode-module-loader`): typecheck PASS (16 projects), `check:deps` PASS
(madge: no circular dependency), `test:run` **891 passed / 17 skipped / 0 failed**,
biome clean on the changed-files set. The only red is the pre-existing whole-tree
`pnpm lint` debt in `packages/npm-client/src/installer.ts` (2 errors, lines 508 /
511), unrelated to this effort and untouched.

- **TS-on-import across the module graph** (feature 02). `.ts`/`.tsx` are
  first-class resolvable + ESM extensions (ordered after the `.js` family so
  plain-JS packages are byte-unchanged), type-stripped on import via an injected
  esbuild WASI `transformSource` hook on `ModuleLoaderOptions`. `.d.ts` excluded
  from candidate matching; `require()` of a `.ts` CJS-scope module loud-throws;
  id-keyed transform cache. **Ratified: ADR-0052** (transform hook) + **ADR-0053**
  (`.ts`/`.tsx` extensions). Commits `ef41164`, `5ef51e0`, `19dbeac`, `b63ff27`,
  `c12d864`, `1be1201`, `3ddf9b0`, `c283c20`. **The gold multi-file `.ts` parity
  case is GREEN** (`85ed795`, `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts`)
  — diffed head-to-head against Node-via-`tsx`. **P0's language unit is closed**;
  P0's tree-integration half (the createRoutes graph, F02-T9) is now **GREEN** —
  the GRAPH-LOAD and BOOT gates both pass against the vendored tree.

- **Effect consumes rifty `node:http` AS-IS** (feature 05). `HttpServer.listen`
  options-object overload; `ServerResponse` emits Node-style `'drain'`;
  no-handler `createServer()` + `on('request')` buffered `res.end(JSON)` returns
  200; WS/SSE upgrade boundary negative-locked; opt-in parity-net mode with real
  Node-vs-rifty `node:http` parity cases. **Ratified: ADR-0054** (additive
  shape-widening, no dedicated Effect adapter; pipe-sink DEFERRED). Commits
  `39bff6a`, `12edbd2`, `376e3cd`, `faaaf8f`, `8fe16b8`.

- **SSE-over-streaming-HTTP principle** (feature 07). opencode's `/event` route is
  `text/event-stream` over HTTP GET, not a WebSocket; it flows page-direct over
  the existing SW→page bridge with no new code (`ServerResponse.toResponse()`
  resolves a live-stream `Response` at header-flush). **Ratified: ADR-0055** (no
  `ws` shim; page-direct only). The page↔Worker v3 frame bump is DEFERRED (see
  below).

- **F09 tool-ceiling marker** (feature 09). Pure-JS `vfsGrep` over `node:fs` (zero
  spawn, not a public export), read-substitute parity, failure-mode contracts,
  and a spawn-ceiling conformance test pinning `spawn('git'|'bash')` →
  ENOENT/exit-127 (never fake-succeeds) + PTY throw-on-create. Commits `61da8da`,
  `15c6895`, `93e055b`, `6e5b2e5`. The authoritative FEASIBLE-vs-IMPOSSIBLE table
  is `docs/compat/opencode-tool-ceiling.md` (`3890fc6`). The earlier `vfsGrep`
  global/sticky-RegExp silent-zero-match (review MAJOR) is **fixed** (`8a57400`).

- **`node:sqlite` `DatabaseSync` shim over `sql.js` — built, green, wired**
  (features 03/04, ADR-0065). `packages/net/src/sqlite/` (`engine.ts`,
  `database-sync.ts`, `statement-sync.ts`, `register-builtins.ts`): a synchronous
  in-memory `DatabaseSync`-compatible surface over `sql.js`, parity-tested
  head-to-head vs real `node:sqlite` (Node 24). **Wired into the module loader**
  as a `node:sqlite` builtin via the `@rifty/io` `registerBuiltin` forward seam
  (ADR-0035) — `registerBuiltin('sqlite', () => ({ DatabaseSync }))`, zero reverse
  imports, madge-clean. Proven end-to-end by `tests/conformance/builtins/sqlite-loader-roundtrip.test.ts`
  (guest `require('node:sqlite')` through `createModuleLoader` opens `:memory:`,
  INSERTs, SELECTs back `{v:42}`) plus the heavier `sqlite-opencode-boot` gate.
  Commits `7ed6bf8`, `99c3c9f`, `65917a3`, `304d785`.

- **Read-overflow RangeError parity (harden, `44f983d`).** Default integer reads
  that exceed `Number.MAX_SAFE_INTEGER` now **throw `RangeError`/`ERR_OUT_OF_RANGE`**
  (`guardSafeInteger()` in `statement-sync.ts`, both row shapes) instead of
  returning a truncated number — matching real Node v24 byte-for-byte (first
  refusal at exactly `2^53`; `±MAX_SAFE` read fine). Driven TDD by the new parity
  case `tools/node-parity-runner/cases/sqlite/read-bigint-overflow.case.ts` (red
  first, then green). **Honest documented caveat:** a whole-valued REAL column
  above `2^53` is indistinguishable from a truncated INTEGER through sql.js's
  JS-number return (no `sqlite3_column_type` on the public API), so the guard
  errs toward *refusing a possibly-truncated value* over silently lying — it
  cannot fire on opencode's boot path (its INTEGER timestamps are `Date.now()`
  ms, ~`1.7e12`, three orders below `2^53`). Also shipped: an **ADR-0065 erratum**
  (append-only; Decision untouched) correcting two framing statements verified
  directly in vendored source — (a) `drizzle-orm/node-sqlite` **IS** wired over the
  same `DatabaseSync` at SHA `f401f01` (`core/src/database/sqlite.node.ts` line 2 /
  169), so the shim must satisfy drizzle's usage too (it does — same surface);
  (b) per-query `setReadBigInts(Context.get(…, Client.SafeIntegers))` (lines 59/74)
  with the effect@4 `SafeIntegers` reference defaulting to `false`. OPFS persistence
  remains deferred under `Q-2026-05-31-301` (real `TODO(ADR)` marker at the
  in-memory backing site in `database-sync.ts`).

- **Module resolver: most-specific wildcard + null-block (`a397f05`).** Found and
  fixed a **real Node-24 parity bug** while wiring effect@4's exports map:
  `findWildcard` (`packages/runtime-js/src/module-loader/resolver.ts`) returned the
  *first* insertion-order wildcard match and could not honour `null`-target blocks,
  so `effect/internal/*` leaked through effect@4's catch-all `./*` instead of being
  blocked. Rewritten to select longest-base / longest-trailer (Node
  `PACKAGE_IMPORTS_EXPORTS_RESOLVE`) with a tri-state `undefined`(no-match) /
  `null`(block) / string(resolve). Classified REVERSIBLE (Node-parity bug, internal,
  no public API, no new dep — no ADR); pinned by 6 new conformance tests in
  `tests/conformance/modules/resolver.test.ts` (51/51 green) verified against the
  real vendored package.json maps. The latent gap was NOT on opencode's path but is
  genuine correctness. Companion cross-file TS effect-syntax parity case
  (`ts-effect-syntax-cross-file.case.ts`, `57b45a2`) covers `import type` / `const
  enum` / `satisfies`; **stage-3 decorators are an honestly-recorded esbuild
  passthrough gap** (`Q-2026-05-31-304`, off opencode's path — opencode uses no
  decorators).

> Slate renumber note: ADR-0054/0055 ratified the SSE/Effect-HTTP drafts under
> *next-free* ADR numbers, NOT under their `decisions.md` draft numbers (0057,
> 0059). In `decisions.md` numbering, "ADR-0055" is the WASM-SQLite draft and
> "ADR-0056" the drizzle-adapter draft — both now SUPERSEDED by the ratified
> on-disk **ADR-0065** (which corrects the `bun:sqlite`→`node:sqlite` framing and
> voids the drizzle adapter at the pinned SHA). Each on-disk ADR states which
> `decisions.md` draft it ratifies or supersedes to make the mapping explicit.

## What shipped — F01 vendoring (done)

- **Vendor opencode (feature 01) — DONE.** anomalyco/opencode pinned at SHA
  `f401f01c05bead2fd0687004c912743d271e2b7b` (branch `dev`). Committed in
  `e8be3b2` (`vendor(opencode): pin … server-path source + facade manifest +
  fetch script (F01)`). **5.6 MB / 911 files committed**, no `node_modules` in
  the tree.
  - **Source fixture:** `tests/integration/fixtures/opencode/source/` — whole
    `src/` of the 7 server-path packages (`opencode` 593, `core` 177, `llm` 56,
    `sdk` 41, `effect-drizzle-sqlite` 21, `plugin` 8, `ui` 6 files). The 5
    workspace siblings beyond `opencode` were added after the first pass shipped
    only `opencode`; an import-graph re-trace against the fixture now resolves
    **470 internal files, 0 unresolved**.
  - **Programmatic entry:** import `Server` from
    `source/packages/opencode/src/server/server.ts` (`export * as Server`;
    `Server.listen(opts)`). **Never `src/node.ts`** (its `Database` re-export
    reaches the `bun:sqlite` import-time crash). The CLI entry `src/index.ts` is
    also crash-prone and out of scope.
  - **Dependency snapshot (fetch-on-demand, NOT committed inline):**
    `tests/integration/fixtures/opencode/facade-manifest.json` +
    `deps/package.json` + `deps/package-lock.json` (157 KB, committed). The
    flattened npm manifest is **36 deps + 4 optionalDependencies** (catalog: →
    concrete versions, workspace:* dropped since the source is vendored). `cd
    deps && npm ci` reproduces the **~217 MB / 327-package** `node_modules`
    deterministically (re-verified: exit 0, lockfile unchanged) — mirroring the
    esbuild.wasm "pinned-fetch-script over committed-binary" house style.
  - **Repro script:** `tools/shadow-registry/scripts/fetch-opencode.mjs`
    (esbuild-style, zero non-builtin deps, clone-at-SHA → copy → regenerate
    manifest → `npm ci` validate). Re-running is a no-op diff against the
    committed manifest.
  - **Dep-resolution gaps (honest):** every KEEP dep resolved (0 failed at
    install). The 4 natives/wasm — `@parcel/watcher`, `@lydell/node-pty`,
    `@silvia-odwyer/photon-node`, `web-tree-sitter` — are in
    `optionalDependencies` and resolved as **darwin-arm64 prebuilds / wasm** (no
    compilation). They are reached by STATIC imports in the server graph
    (`pty.node.ts`, `file/watcher.ts`, `tool/shell.ts`→tree-sitter,
    `image.ts`→photon), so they cannot simply be omitted — a Spike-C-era runtime
    consideration, not an install blocker. Concrete `@ai-sdk/*` providers and
    `@npmcli/arborist` are **dynamic `import()`** (fetch-on-demand), intentionally
    excluded from KEEP. This is a Bun monorepo using `catalog:`/`workspace:`
    protocols; the npm manifest is a hand-flattened projection, NOT opencode's
    native install graph (`bun.lock` not committed). `node:sqlite` resolves under
    the `node` condition (needs Node ≥22), dodging `bun:sqlite`.

## Spike C — VERDICT: eager-database, WASM-SQLite pulled forward to P2

**Confidence: high (static analysis against the vendored tree; no live boot —
no `node_modules` in the clone).** The task premise was stale: the `#db` import
map points at `src/storage/db.{node,bun}.ts` which **do not exist** at this SHA
and nothing imports `#db`; `storage.ts` is now pure JSON-file storage. The REAL
DB is `Database` from `@opencode-ai/core/database`, and it is **NOT lazy**.

Verified chain in the vendored source: `Server.listen` (`server.ts:75`) →
`Layer.buildWithMemoMap` (`:129`, **eager full-DAG build**) →
`HttpApiApp.createRoutes` which UNCONDITIONALLY provides
`fenceLayer.pipe(Layer.provide(Database.defaultLayer))` and `Database.defaultLayer`
(`httpapi/server.ts:193,195`). `fenceLayer` is a `Layer.effect` whose **acquire**
runs `const { db } = yield* Database.Service` (`middleware/fence.ts:9-11`) — at
layer-build, not per-request. That forces `Database.layer` (`core/database/database.ts:21`)
whose acquire runs `makeDatabase`, `PRAGMA journal_mode = WAL` + 5 more PRAGMAs,
then `DatabaseMigration.apply(db)` (~24 migration files, real `CREATE TABLE`/
`SELECT`/`INSERT` DDL) — all under `Effect.orDie` (`:35`). `makeDatabase` →
`sqlite.node.ts` runs `new DatabaseSync(filename, {open: true})` (`:151,156`)
with a top-level `import … from "node:sqlite"` (`:1`). Module-eval is clean
(`routes = createRoutes()` at `:245` is a lazy blueprint), but the construction
happens at **layer-build during `Server.listen`**, unconditionally, before any
request. opencode's own boot tests confirm this — `test/preload.ts` sets
`OPENCODE_DB=:memory:` to provision a real SQLite for the HTTP layer.

**Milestone implication:** a throw-on-USE SQLite stub is **NOT sufficient** to
reach "first light" — the first `db.run` on a throw-stub becomes a defect that
dies the layer build and fails `Server.listen`. Reaching "server boots + responds"
needs a **functioning** SQLite (`node:sqlite` `DatabaseSync` surface OR a
drizzle-`node-sqlite`-compatible WASM shim) that can open `:memory:`, tolerate/no-op
`PRAGMA journal_mode=WAL`, and execute the migration DDL — landing in **P2 before
any server-boot smoke test**, not deferred to P4. The WASM-SQLite engine decision
is now **RATIFIED as ADR-0065**: the engine is **`sql.js`** (pure-JS WASM SQLite,
SYNCHRONOUS API, in-memory-first), registered as a rifty **`node:sqlite` builtin**
exposing a `DatabaseSync`-compatible synchronous surface; the
`@sqlite.org/sqlite-wasm`-vs-`sql.js` evaluation (ADR-0006) is resolved in favour
of `sql.js` for the synchronous in-memory boot (official build kept for the
deferred OPFS path), and the COI/SAB analysis (ADR-0002) confirms in-memory needs
neither. ADR-0065 supersedes the decisions.md DRAFTS ADR-0055/0056. **Spike C is now
FULLY LIVE-confirmed:** the GRAPH-LOAD gate drove a real `Server` import against the
vendored tree (real esbuild transform + `node:sqlite` shim wired), resolving past
every previously-suspected blocker (the `@/` tsconfig alias, effect@4
`unstable/http`+`unstable/httpapi`, the workspace `#db`/`#pty` imports-map, and the
`node:diagnostics_channel` + undici surface), and the **BOOT gate** then invoked
`Server.listen` headless — the eager `Layer.buildWithMemoMap` reached the
`fenceLayer` → `Database.Service` acquire and the real drizzle/sql.js layer ran the
6 PRAGMAs + ~24 migrations under `Effect.orDie` with **no wall**. The eager-`Database`
acquire-time pull predicted by Spike C is reached at runtime and succeeds.

## GRAPH-LOAD gate (F02-T9) — DRIVEN LIVE, result: ✅ PASSED (2026-06-01)

**The real `Server` import resolves + evaluates the whole ~900-file server graph
and exposes `Server.listen` as a function.** Harness:
`tests/integration/fixtures/opencode-graph-load-smoke.ts` + opt-in driver
`tests/integration/opencode-graph-load.opt-in.test.ts`. It builds a memory/sync VFS
(vendored `source/packages/*` + materialized `deps/node_modules` under `/workspace`,
workspace pkgs mirrored into `node_modules`), wires `createModuleLoader` with the
real esbuild WASI `transformSource` (ADR-0052), the `node:sqlite` sql.js shim
(ADR-0065), the tsconfig `paths` aliases (ADR-0066), and `node:net`/`http`/`https`,
then imports the programmatic entry `…/server/server.ts`. The opt-in gate prints
`RIFTY_OPENCODE_GRAPH_LOAD_OK` and **passes green (genuine OK, not
skip-with-reason)** under `RIFTY_RUN_OPENCODE_GRAPH_LOAD=1` (~8s warm).

**How the wall-by-wall path was cleared (2026-06-01 session, 16 commits on `main`,
`b425b05..ea846ef`):** the graph was driven live and each exact wall fixed in graph
order — TDD'd (Node parity case where a baseline exists, else conformance), full
`pnpm test:run` green after each load-bearing change (948 tests), an ADR per
irreversible decision. In order: `node:diagnostics_channel` + the undici/effect/mDNS
builtin surface (`util.debuglog`, `console`, `util/types`, `worker_threads` markers,
`dgram`) [prior session] → **`@/` tsconfig path aliases (ADR-0066)** → file-before-
directory resolution → **ESM self-namespace** `export * as X from "."` live-binding
→ **global-`Object` shadowing** in export codegen → **`async_hooks.AsyncLocalStorage`**
→ **`node:stream/consumers`** → **`node:timers/promises`** → **`node:http2`** facade +
real `constants` → CJS-compile-error context → **text-asset imports (ADR-0067)** →
**`with { type: "file" }` file loader (ADR-0068)** → missing facade deps
(`@opentelemetry/resources`, `@smithy/eventstream-codec` + `util-utf8`, `aws4fetch`).
The full chronology + the next gate is in [`HANDOFF.md`](HANDOFF.md). The
`node:diagnostics_channel` wall (the prior "BLOCKED" verdict) and every wall after
it are now cleared.

## BOOT gate (`Server.listen` first light) — result: ✅ PASSED (2026-06-01)

**`Server.listen` boots headless and serves real routes — zero walls.** Harness:
`tests/integration/fixtures/opencode-boot-smoke.ts` (shares the realm builder
`opencode-vfs-harness.ts` with the graph-load gate) + opt-in driver
`tests/integration/opencode-boot.opt-in.test.ts`. It calls
`Server.listen({ port: 4096, hostname: '127.0.0.1', mdns: false })` with the
headless env (`OPENCODE_DB=:memory:`, `OPENCODE_DISABLE_MDNS=1`,
`NODE_ENV=production`). The eager `Layer.buildWithMemoMap` built the full ~40-layer
DAG: `fenceLayer` pulled `Database.Service`, and the **real**
`@effect/sql-sqlite-node` + `drizzle-orm/node-sqlite` ran the 6 boot PRAGMAs
(`journal_mode=WAL`, …) + **all ~24 migrations** against the `node:sqlite` sql.js
shim (ADR-0065) **under `Effect.orDie`** — a failed migration would have died the
layer and rejected `Server.listen`; it did not. `NodeHttpServer.layer` then bound
the rifty `node:http` server into the port registry, reporting a `TcpAddress`.

Two routes dispatched through the port registry returned **200** (Spike C's
eager-`Database` prediction, now live-confirmed):
- `GET /global/health` → `200 {"healthy":true,"version":"local"}` — a **typed
  Effect `HttpApi` handler** executing per-request (route tree → no-op auth
  middleware → handler → schema-encode), not a static asset.
- `GET /doc` → `200` (306 KB real OpenAPI 3.1.0 spec) — proves the whole route
  tree built.

The opt-in gate prints `RIFTY_OPENCODE_BOOT_OK` and **passes green** under
`RIFTY_RUN_OPENCODE_BOOT=1` (~warm). Auth is a no-op because
`OPENCODE_SERVER_PASSWORD` is unset (`ServerAuth.required()` is false). This run
also demonstrates **Phase-2's core** (a real request→response through Effect
`HttpServer` over the rifty `node:http` bridge, ADR-0054). **Nothing was stubbed**
— in particular the predicted `ptyConnectApi` stub was **not needed**:
`Pty.defaultLayer` builds without constructing a native pty at layer-build (the
native pty is lazy, per-connection). **ADR-0058 (boot builtin additions) resolves
with NO new public builtin surface required** — the boot called no unimplemented
builtin/method; recommendation A (harness-local env only) held.

## What is otherwise DEFERRED (and the exact gate for each)

With F01 done, Spike C decided, the `node:sqlite` shim built+wired+green, and both
the GRAPH-LOAD, BOOT, and DB-READ gates PASSED, the WASM-SQLite/drizzle irreversible
decision is RESOLVED; the remaining items are the deferred process/wire-contract
commitments downstream of boot.

| Deferred work | Gate to unblock |
|--------------|-----------------|
| **WASM-SQLite `node:sqlite` shim (features 03/04) — DONE (P2, RATIFIED, WIRED)** | **RATIFIED + shipped: ADR-0065.** Engine is **`sql.js`** (pure-JS WASM SQLite, SYNCHRONOUS API, in-memory-first), registered as a rifty **`node:sqlite` builtin** exposing a `DatabaseSync`-compatible synchronous surface (matches opencode's `OPENCODE_DB=:memory:` boot path and the `@effect/sql-sqlite-node` + `drizzle-orm/node-sqlite` `DatabaseSync` usage at the pinned SHA — see the ADR-0065 erratum). Built, parity-green vs Node 24, RangeError-overflow-hardened, and **wired into the module loader** (proven by `sqlite-loader-roundtrip` conformance + the `sqlite-opencode-boot` gate). OPFS persistence DEFERRED (`Q-2026-05-31-301`). ADR-0065 SUPERSEDES decisions.md DRAFTS ADR-0055/0056. **No longer a blocker.** |
| **`node:diagnostics_channel` + the undici core builtin surface — CLEARED** | **DONE.** Was the graph-load LIVE wall; the `node:diagnostics_channel` builtin + the undici-driven surface behind it were registered in graph order during the GRAPH-LOAD session (`b425b05..ea846ef`). Graph fully loads. **No longer a blocker.** |
| **Headless server boot (feature 06) — DONE (BOOT gate PASSED)** | **DONE first attempt, zero walls** (see the BOOT gate section above). `Server.listen` boots headless, the eager DAG runs the real drizzle/sql.js PRAGMAs + ~24 migrations under `Effect.orDie`, `/global/health` + `/doc` return 200. **ADR-0058 resolves with NO new builtin surface** (the boot called no unimplemented builtin/method); the predicted `ptyConnectApi` stub was not needed. A DB-read VIA a request (a route that QUERIES drizzle) followed in Phase 2 — see the next row. |
| **DB-read via a request (Phase 2) — DONE (DB-READ gate PASSED)** | **DONE, zero walls.** `GET /session` drives the instance-context middleware (instance resolved from cwd `/workspace`), builds the lazy Session/Project/Workspace layers, runs a real drizzle `db.select().from(SessionTable)…all()` (session.ts:1079), and returns `200 []` (empty, fresh in-memory DB). The migrated schema is queryable end-to-end. FileWatcher (no native `@parcel/watcher`) and the `@npmcli/arborist` background install degrade gracefully — opencode logs+continues, the request is unaffected (see `../compat/opencode-tool-ceiling.md`). Gate: `tests/integration/opencode-dbread.opt-in.test.ts`. No new ADR (the degradations sit on the already-drawn no-native-addon line). |
| **v3 SSE frame bump (feature 07)** | **ADR-0060 draft DEFERRED** — non-additive bump of a versioned wire contract (`PREVIEW_PORT_FRAME_VERSION` 2→3) that CONTRADICTS ADR-0048 D2 and ADR-0017's M12 deferral. Page-direct SSE (ADR-0055) ships first with no code. Gate: the Worker becomes the actual opencode owner (ADR-0046 `WorkerOwnerBinding`) AND a superseding ADR cites+supersedes ADR-0048 D2 and amends ADR-0017. |
| **LLM round-trip + `node:https`→fetch (feature 08)** | Needs the vendored tree, a live provider endpoint via env (Q-2026-05-30-116, D-004), and features 01-06. **ADR-0061 draft DEFERRED** (supersedes immutable ADR-0010). Gate: clear the **C1 pre-flight** — inspect pinned `ai@6`/`@ai-sdk/*` source for whether the global-`fetch` path constructs an `https.Agent` at init (a thrown Agent constructor would be init-time-fatal for the round-trip). Run the live flow with `node:https` left as loud-throw FIRST; adopt the client→fetch split only if it actually trips. The superseding ADR must preserve ADR-0010's no-silent-plaintext invariant. |
| **Real ripgrep/git tool fidelity (feature 09, future)** | **ADR-0062 draft is a DEFERRAL tripwire** — adopting ripgrep-WASM / isomorphic-git / wa-sqlite-search (each a NEW external dep) is BLOCKED until a concrete measured need. The pure-JS marker shipped under Q-2026-05-30-061. Do not silently cross this. |

## Critical path

```
vendor opencode (F01) ✅  →  Spike C ✅ (eager Database)  →  node:sqlite sql.js shim ✅ (ADR-0065, wired+green)
        │ DONE e8be3b2          │ DONE (static)               │ DONE 7ed6bf8..304d785, hardened 44f983d
        └─────────────────────  spine + persistence resolved  ──────────────────────┘
                                   │
   GRAPH-LOAD smoke (F02-T9) ✅ PASSED — import { Server } resolves+evaluates the ~900-file graph
                                   │  (diagnostics_channel + undici surface cleared, b425b05..ea846ef)
                                   ▼
   BOOT gate (F06) ✅ PASSED — Server.listen boots the eager ~40-layer DAG (real drizzle/sql.js
                                   │  migrations under Effect.orDie); /global/health + /doc → 200
                                   ▼
   DB-READ gate (Phase 2) ✅ PASSED — GET /session drives the instance context + lazy Session/
                                   │  Project/Workspace layers → real drizzle SELECT → 200 [] (empty,
                                   │  fresh DB). FileWatcher/arborist degrade gracefully (not walls).
                                   ▼
   ►►► NEXT: Phase 3 — create a session + 1 LLM round-trip (P4), after the C1 https.Agent pre-flight
                     →  tool ceiling already marked (P5, shipped)
```

The original spine `vendor opencode → Spike C → WASM-SQLite decision` is **fully
cleared**, and so are the three live gates that followed it: **GRAPH-LOAD** (the
graph resolves + evaluates), **BOOT** (`Server.listen` boots + serves routes,
exercising the real drizzle/sql.js layer via the eager migration run), and
**DB-READ** (`GET /session` performs a real drizzle SELECT through the instance
context → `200 []`). What remains is **Phase 3** — create a session + one LLM
round-trip, holding on the C1 `https.Agent` pre-flight (ADR-0061 draft). P5 (the
tool ceiling) is already marked.

## Single next unblocked step

**Phase 3 — a session + one LLM round-trip (P4).** The server boots, serves typed
routes, and reads its migrated drizzle schema end-to-end. The remaining milestone
is the agent round-trip: `POST /session` (create) then a prompt that drives one
LLM call over `fetch`. **C1 pre-flight first** — inspect the pinned `ai@6` /
`@ai-sdk/*` source for whether the global-`fetch` path constructs an `https.Agent`
at init (a thrown Agent ctor would be init-fatal). Run with `node:https` left as a
loud-throw FIRST; adopt the client→fetch split ONLY if it actually trips. Live
provider endpoint via env (D-004). **ADR-0061 draft** (supersedes immutable
ADR-0010) ratifies here and must preserve the no-silent-plaintext invariant.

## Links

- Decision register (full ADR-draft text + the reversible Q-block):
  [decisions.md](decisions.md)
- Retained feature designs (each cited by a ratified, immutable ADR's References
  section): [feature-02-ts-on-import-graph.md](feature-02-ts-on-import-graph.md)
  (ADR-0052/0053) · [feature-05-effect-http-bridge.md](feature-05-effect-http-bridge.md)
  (ADR-0054) · [feature-07-ws-sse-bridge.md](feature-07-ws-sse-bridge.md) (ADR-0055).
  The other 6 feature designs + the adversarial review + the execution log were
  consolidated into this doc (2026-05-31).
- Feasibility study:
  [`../opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md)
- Tool-execution boundary (compat source-of-truth):
  [`../compat/opencode-tool-ceiling.md`](../compat/opencode-tool-ceiling.md)
- GRAPH-LOAD gate harness (opt-in, PASSED): `tests/integration/opencode-graph-load.opt-in.test.ts`
- BOOT gate harness (opt-in, PASSED): `tests/integration/opencode-boot.opt-in.test.ts` +
  `tests/integration/fixtures/opencode-boot-smoke.ts`
- DB-READ gate harness (opt-in, PASSED, Phase 2): `tests/integration/opencode-dbread.opt-in.test.ts` +
  `tests/integration/fixtures/opencode-dbread-smoke.ts`
- Shared realm builder for all three gates:
  `tests/integration/fixtures/opencode-vfs-harness.ts`
- `node:sqlite` `DatabaseSync` shim: `packages/net/src/sqlite/` (`engine.ts`,
  `database-sync.ts`, `statement-sync.ts`, `register-builtins.ts`); loader-wiring
  proof `tests/conformance/builtins/sqlite-loader-roundtrip.test.ts`; compat
  `../compat/sqlite.md`
- Ratified ADRs: [0052](../adr/0052-ts-on-import-transform-hook.md) ·
  [0053](../adr/0053-ts-tsx-first-class-resolvable-extensions.md) ·
  [0054](../adr/0054-effect-consumes-node-http-as-is.md) ·
  [0055](../adr/0055-opencode-sse-streaming-http-no-ws-shim.md) ·
  [0065](../adr/0065-node-sqlite-databasesync-wasm-shim.md) (WASM-SQLite
  `node:sqlite` shim — supersedes decisions.md DRAFTS ADR-0055/0056)
