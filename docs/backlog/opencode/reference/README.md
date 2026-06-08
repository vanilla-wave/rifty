# M12 (proposed) — opencode server facade in rifty

> **STAGED PROPOSAL — partially shipped.** Current-state doc for running
> **anomalyco/opencode** (the Effect/Bun TypeScript *source* graph, not the published
> native `opencode-ai` npm package) inside rifty as a **no-tool-execution agent
> facade**. Per-feature designs + the adversarial review that produced this plan were
> consolidated away (2026-05-31 doc audit); their load-bearing content is below. Full
> decision register (every ADR draft, ratified + deferred): [`decisions.md`](decisions.md).
> Feasibility verdict: [`../opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md).

## Goal and verdict

Goal: run opencode's Effect HTTP server headlessly — build its ~40 Effect layers,
serve trivial routes, create a session, do one LLM round-trip. It **cannot** spawn
processes, run a shell, drive native git/ripgrep, or open a PTY.

Verdict: **feasible-with-major-work (medium confidence)** — portable as a server
facade up to a hard, browser/WASI-imposed **tool-execution ceiling**. rifty already
runs real express@4 + vite@5 in-process, so "big Node/Effect server" is not the
blocker; tool execution (spawn/PTY/native git/ripgrep) is.

opencode is **vendored** at a pinned SHA (F01 below). Spike C (static analysis vs the
vendored tree) **pulls WASM-SQLite forward from P4 to a P2 boot prerequisite**:
`Server.listen` builds the layer DAG eagerly and opens + migrates a real `Database`
(`node:sqlite` `DatabaseSync`) at layer-build, not lazily. The `node:sqlite`
`DatabaseSync` shim (ADR-0065, `sql.js` engine) is built, green, and wired into the
module loader as a `node:sqlite` builtin; the TS-on-import transform + resolver are
wired for the real graph.

Three live gates are **✅ GREEN** (Spike C's eager-`Database` prediction live-confirmed):
- **GRAPH-LOAD** (F02-T9) — resolves + evaluates the whole ~900-file server graph,
  exposes `Server.listen`.
- **BOOT** (F06) — `Server.listen` headless; the eager ~40-layer DAG builds, the real
  drizzle/sql.js layer runs PRAGMAs + ~24 migrations under `Effect.orDie`;
  `/global/health` + `/doc` return 200.
- **DB-READ** (Phase 2) — `GET /session` runs a real drizzle SELECT, returns `200 []`,
  proving the migrated schema is queryable through a request.

Next gate: Phase 3 (create a session + one LLM round-trip).

## What shipped (green)

Last full local verification on HEAD `490230a` (branch `wire-opencode-module-loader`):
typecheck PASS (16 projects), `check:deps` PASS (madge: no circular dep), `test:run`
**891 passed / 17 skipped / 0 failed**, biome clean on changed files. Only red is
pre-existing whole-tree `pnpm lint` debt in `packages/npm-client/src/installer.ts`
(2 errors, lines 508 / 511), unrelated and untouched.

- **TS-on-import across the module graph** (feature 02). `.ts`/`.tsx` are first-class
  resolvable + ESM extensions (ordered after `.js` so plain-JS packages are
  byte-unchanged), type-stripped on import via an injected esbuild WASI
  `transformSource` hook on `ModuleLoaderOptions`. `.d.ts` excluded from candidates;
  `require()` of a `.ts` CJS-scope module loud-throws; id-keyed transform cache.
  **Ratified: ADR-0052** (transform hook) + **ADR-0053** (`.ts`/`.tsx` extensions).
  Commits `ef41164`, `5ef51e0`, `19dbeac`, `b63ff27`, `c12d864`, `1be1201`,
  `3ddf9b0`, `c283c20`. Gold multi-file `.ts` parity case GREEN (`85ed795`,
  `tools/node-parity-runner/cases/modules/ts-graph-cross-file.case.ts`) — diffed
  head-to-head vs Node-via-`tsx`. P0's language unit is closed; its tree-integration
  half (the createRoutes graph, F02-T9) is GREEN (GRAPH-LOAD + BOOT pass).

- **Effect consumes rifty `node:http` AS-IS** (feature 05). `HttpServer.listen`
  options-object overload; `ServerResponse` emits Node-style `'drain'`; no-handler
  `createServer()` + `on('request')` buffered `res.end(JSON)` returns 200; WS/SSE
  upgrade boundary negative-locked; opt-in parity-net mode with real Node-vs-rifty
  `node:http` parity cases. **Ratified: ADR-0054** (additive shape-widening, no
  dedicated Effect adapter; pipe-sink DEFERRED). Commits `39bff6a`, `12edbd2`,
  `376e3cd`, `faaaf8f`, `8fe16b8`.

- **SSE-over-streaming-HTTP principle** (feature 07). opencode's `/event` route is
  `text/event-stream` over HTTP GET, not a WebSocket; it flows page-direct over the
  existing SW→page bridge with no new code (`ServerResponse.toResponse()` resolves a
  live-stream `Response` at header-flush). **Ratified: ADR-0055** (no `ws` shim;
  page-direct only). The page↔Worker v3 frame bump is DEFERRED (below).

- **F09 tool-ceiling marker** (feature 09). Pure-JS `vfsGrep` over `node:fs` (zero
  spawn, not a public export), read-substitute parity, failure-mode contracts, and a
  spawn-ceiling conformance test pinning `spawn('git'|'bash')` → ENOENT/exit-127
  (never fake-succeeds) + PTY throw-on-create. Commits `61da8da`, `15c6895`,
  `93e055b`, `6e5b2e5`. Authoritative FEASIBLE-vs-IMPOSSIBLE table:
  `docs/compat/opencode-tool-ceiling.md` (`3890fc6`). The earlier `vfsGrep`
  global/sticky-RegExp silent-zero-match (review MAJOR) is fixed (`8a57400`).

- **`node:sqlite` `DatabaseSync` shim over `sql.js` — built, green, wired**
  (features 03/04, ADR-0065). `packages/net/src/sqlite/` (`engine.ts`,
  `database-sync.ts`, `statement-sync.ts`, `register-builtins.ts`): a synchronous
  in-memory `DatabaseSync`-compatible surface over `sql.js`, parity-tested vs real
  `node:sqlite` (Node 24). Wired into the module loader as a `node:sqlite` builtin via
  the `@riftydev/io` `registerBuiltin` forward seam (ADR-0035) —
  `registerBuiltin('sqlite', () => ({ DatabaseSync }))`, zero reverse imports,
  madge-clean. Proven end-to-end by
  `tests/conformance/builtins/sqlite-loader-roundtrip.test.ts` (guest
  `require('node:sqlite')` through `createModuleLoader` opens `:memory:`, INSERTs,
  SELECTs back `{v:42}`) plus the heavier `sqlite-opencode-boot` gate. Commits
  `7ed6bf8`, `99c3c9f`, `65917a3`, `304d785`.

- **Read-overflow RangeError parity (harden, `44f983d`).** Default integer reads
  exceeding `Number.MAX_SAFE_INTEGER` now **throw `RangeError`/`ERR_OUT_OF_RANGE`**
  (`guardSafeInteger()` in `statement-sync.ts`, both row shapes) instead of returning
  a truncated number — matching real Node v24 byte-for-byte (first refusal at exactly
  `2^53`; `±MAX_SAFE` read fine). Driven TDD by parity case
  `tools/node-parity-runner/cases/sqlite/read-bigint-overflow.case.ts` (red→green).
  **Documented caveat:** a whole-valued REAL column above `2^53` is indistinguishable
  from a truncated INTEGER through sql.js's JS-number return (no `sqlite3_column_type`
  on the public API), so the guard errs toward *refusing a possibly-truncated value*
  over silently lying — it cannot fire on opencode's boot path (its INTEGER timestamps
  are `Date.now()` ms, ~`1.7e12`, three orders below `2^53`). Also: an **ADR-0065
  erratum** (append-only; Decision untouched) correcting two framings verified in
  vendored source — (a) `drizzle-orm/node-sqlite` **IS** wired over the same
  `DatabaseSync` at SHA `f401f01` (`core/src/database/sqlite.node.ts` line 2 / 169),
  so the shim must satisfy drizzle too (it does — same surface); (b) per-query
  `setReadBigInts(Context.get(…, Client.SafeIntegers))` (lines 59/74) with the effect@4
  `SafeIntegers` reference defaulting to `false`. OPFS persistence deferred under
  `Q-2026-05-31-301` (real `TODO(ADR)` marker at the in-memory backing site in
  `database-sync.ts`).

- **Module resolver: most-specific wildcard + null-block (`a397f05`).** Found+fixed a
  **real Node-24 parity bug** while wiring effect@4's exports map: `findWildcard`
  (`packages/runtime-js/src/module-loader/resolver.ts`) returned the *first*
  insertion-order wildcard match and could not honour `null`-target blocks, so
  `effect/internal/*` leaked through effect@4's catch-all `./*` instead of being
  blocked. Rewritten to select longest-base / longest-trailer (Node
  `PACKAGE_IMPORTS_EXPORTS_RESOLVE`) with a tri-state `undefined`(no-match) /
  `null`(block) / string(resolve). Classified REVERSIBLE (Node-parity bug, internal,
  no public API, no new dep — no ADR); pinned by 6 new conformance tests in
  `tests/conformance/modules/resolver.test.ts` (51/51 green) vs the real vendored
  package.json maps. Latent gap was NOT on opencode's path but is genuine correctness.
  Companion cross-file TS effect-syntax parity case (`ts-effect-syntax-cross-file.case.ts`,
  `57b45a2`) covers `import type` / `const enum` / `satisfies`; **stage-3 decorators
  are an honestly-recorded esbuild passthrough gap** (`Q-2026-05-31-304`, off
  opencode's path — opencode uses no decorators).

> **Slate renumber note:** ADR-0054/0055 ratified the SSE/Effect-HTTP drafts under
> *next-free* ADR numbers, NOT their `decisions.md` draft numbers (0057, 0059). In
> `decisions.md` numbering, "ADR-0055" is the WASM-SQLite draft and "ADR-0056" the
> drizzle-adapter draft — both now SUPERSEDED by ratified on-disk **ADR-0065**
> (corrects `bun:sqlite`→`node:sqlite`, voids the drizzle adapter at the pinned SHA).
> Each on-disk ADR states which `decisions.md` draft it ratifies or supersedes.

## What shipped — F01 vendoring (done)

anomalyco/opencode pinned at SHA `f401f01c05bead2fd0687004c912743d271e2b7b` (branch
`dev`), committed in `e8be3b2` (`vendor(opencode): pin … server-path source + facade
manifest + fetch script (F01)`). **5.6 MB / 911 files committed**, no `node_modules`
in the tree.

- **Source fixture:** `tests/integration/fixtures/opencode/source/` — whole `src/` of
  the 7 server-path packages (`opencode` 593, `core` 177, `llm` 56, `sdk` 41,
  `effect-drizzle-sqlite` 21, `plugin` 8, `ui` 6 files). The 5 workspace siblings
  beyond `opencode` were added after the first pass shipped only `opencode`; an
  import-graph re-trace now resolves **470 internal files, 0 unresolved**.
- **Programmatic entry:** import `Server` from
  `source/packages/opencode/src/server/server.ts` (`export * as Server`;
  `Server.listen(opts)`). **Never `src/node.ts`** (its `Database` re-export reaches the
  `bun:sqlite` import-time crash); CLI entry `src/index.ts` is also crash-prone and out
  of scope.
- **Dependency snapshot (fetch-on-demand, NOT committed inline):**
  `tests/integration/fixtures/opencode/facade-manifest.json` + `deps/package.json` +
  `deps/package-lock.json` (157 KB, committed). Flattened npm manifest is **36 deps +
  4 optionalDependencies** (catalog: → concrete versions, workspace:* dropped since
  source is vendored). `cd deps && npm ci` reproduces the **~217 MB / 327-package**
  `node_modules` deterministically (re-verified: exit 0, lockfile unchanged) —
  mirroring the esbuild.wasm "pinned-fetch-script over committed-binary" style.
- **Repro script:** `tools/shadow-registry/scripts/fetch-opencode.mjs` (esbuild-style,
  zero non-builtin deps, clone-at-SHA → copy → regenerate manifest → `npm ci`
  validate). Re-running is a no-op diff against the committed manifest.
- **Dep-resolution gaps (honest):** every KEEP dep resolved (0 failed at install). The
  4 natives/wasm — `@parcel/watcher`, `@lydell/node-pty`,
  `@silvia-odwyer/photon-node`, `web-tree-sitter` — are in `optionalDependencies`,
  resolved as **darwin-arm64 prebuilds / wasm** (no compilation). They are reached by
  STATIC imports in the server graph (`pty.node.ts`, `file/watcher.ts`,
  `tool/shell.ts`→tree-sitter, `image.ts`→photon), so cannot simply be omitted — a
  Spike-C-era runtime consideration, not an install blocker. Concrete `@ai-sdk/*`
  providers and `@npmcli/arborist` are **dynamic `import()`** (fetch-on-demand),
  intentionally excluded from KEEP. This is a Bun monorepo using
  `catalog:`/`workspace:` protocols; the npm manifest is a hand-flattened projection,
  NOT opencode's native install graph (`bun.lock` not committed). `node:sqlite`
  resolves under the `node` condition (needs Node ≥22), dodging `bun:sqlite`.

## Spike C — VERDICT: eager-database, WASM-SQLite pulled forward to P2

**Confidence: high** (static analysis vs the vendored tree; no live boot — no
`node_modules` in the clone). The task premise was stale: the `#db` import map points
at `src/storage/db.{node,bun}.ts` which **do not exist** at this SHA and nothing
imports `#db`; `storage.ts` is now pure JSON-file storage. The REAL DB is `Database`
from `@opencode-ai/core/database`, and it is **NOT lazy**.

Verified chain: `Server.listen` (`server.ts:75`) → `Layer.buildWithMemoMap` (`:129`,
eager full-DAG build) → `HttpApiApp.createRoutes` which UNCONDITIONALLY provides
`fenceLayer.pipe(Layer.provide(Database.defaultLayer))` and `Database.defaultLayer`
(`httpapi/server.ts:193,195`). `fenceLayer` is a `Layer.effect` whose **acquire** runs
`const { db } = yield* Database.Service` (`middleware/fence.ts:9-11`) — at layer-build,
not per-request. That forces `Database.layer` (`core/database/database.ts:21`) whose
acquire runs `makeDatabase`, `PRAGMA journal_mode = WAL` + 5 more PRAGMAs, then
`DatabaseMigration.apply(db)` (~24 migration files, real `CREATE TABLE`/`SELECT`/`INSERT`
DDL) — all under `Effect.orDie` (`:35`). `makeDatabase` → `sqlite.node.ts` runs
`new DatabaseSync(filename, {open: true})` (`:151,156`) with top-level
`import … from "node:sqlite"` (`:1`). Module-eval is clean (`routes = createRoutes()`
at `:245` is a lazy blueprint), but construction happens at **layer-build during
`Server.listen`**, unconditionally, before any request. opencode's own boot tests
confirm this — `test/preload.ts` sets `OPENCODE_DB=:memory:`.

**Implication:** a throw-on-USE SQLite stub is **NOT sufficient** to reach "first
light" — the first `db.run` dies the layer build and fails `Server.listen`. Boot needs
a **functioning** SQLite (`node:sqlite` `DatabaseSync` OR a
drizzle-`node-sqlite`-compatible WASM shim) that opens `:memory:`, tolerates/no-ops
`PRAGMA journal_mode=WAL`, and executes the migration DDL — landing in **P2 before any
server-boot smoke test**, not P4. The engine decision is **RATIFIED as ADR-0065**:
**`sql.js`** (pure-JS WASM SQLite, SYNCHRONOUS API, in-memory-first), registered as a
rifty `node:sqlite` builtin with a `DatabaseSync`-compatible synchronous surface; the
`@sqlite.org/sqlite-wasm`-vs-`sql.js` evaluation (ADR-0006) resolves in favour of
`sql.js` for synchronous in-memory boot (official build kept for the deferred OPFS
path); the COI/SAB analysis (ADR-0002) confirms in-memory needs neither. ADR-0065
supersedes decisions.md DRAFTS ADR-0055/0056.

**Live-confirmed:** GRAPH-LOAD resolved past every previously-suspected blocker (the
`@/` tsconfig alias, effect@4 `unstable/http`+`unstable/httpapi`, the workspace
`#db`/`#pty` imports-map, `node:diagnostics_channel` + undici surface); BOOT then drove
the eager `Layer.buildWithMemoMap` → `fenceLayer` → `Database.Service` acquire to
success at runtime, with no wall.

## GRAPH-LOAD gate (F02-T9) — DRIVEN LIVE, result: ✅ PASSED (2026-06-01)

**The real `Server` import resolves + evaluates the whole ~900-file server graph and
exposes `Server.listen` as a function.** Harness:
`tests/integration/fixtures/opencode-graph-load-smoke.ts` + opt-in driver
`tests/integration/opencode-graph-load.opt-in.test.ts`. It builds a memory/sync VFS
(vendored `source/packages/*` + materialized `deps/node_modules` under `/workspace`,
workspace pkgs mirrored into `node_modules`), wires `createModuleLoader` with the real
esbuild WASI `transformSource` (ADR-0052), the `node:sqlite` sql.js shim (ADR-0065),
the tsconfig `paths` aliases (ADR-0066), and `node:net`/`http`/`https`, then imports
the programmatic entry `…/server/server.ts`. Prints `RIFTY_OPENCODE_GRAPH_LOAD_OK` and
**passes green (genuine OK, not skip-with-reason)** under
`RIFTY_RUN_OPENCODE_GRAPH_LOAD=1` (~8s warm).

**Walls cleared in graph order** (2026-06-01 session, 16 commits on `main`,
`b425b05..ea846ef`): each TDD'd (Node parity case where a baseline exists, else
conformance), full `pnpm test:run` green after each load-bearing change (948 tests), an
ADR per irreversible decision. In order: `node:diagnostics_channel` + the
undici/effect/mDNS builtin surface (`util.debuglog`, `console`, `util/types`,
`worker_threads` markers, `dgram`) [prior session] → **`@/` tsconfig path aliases
(ADR-0066)** → file-before-directory resolution → **ESM self-namespace**
`export * as X from "."` live-binding → **global-`Object` shadowing** in export codegen
→ **`async_hooks.AsyncLocalStorage`** → **`node:stream/consumers`** →
**`node:timers/promises`** → **`node:http2`** facade + real `constants` →
CJS-compile-error context → **text-asset imports (ADR-0067)** → **`with { type: "file" }`
file loader (ADR-0068)** → missing facade deps (`@opentelemetry/resources`,
`@smithy/eventstream-codec` + `util-utf8`, `aws4fetch`). Full per-wall chronology lived
in a session handoff doc (now in git history). The `node:diagnostics_channel` wall (the
prior "BLOCKED" verdict) and every wall after it are cleared.

## BOOT gate (`Server.listen` first light) — result: ✅ PASSED (2026-06-01)

**`Server.listen` boots headless and serves real routes — zero walls.** Harness:
`tests/integration/fixtures/opencode-boot-smoke.ts` (shares realm builder
`opencode-vfs-harness.ts` with GRAPH-LOAD) + opt-in driver
`tests/integration/opencode-boot.opt-in.test.ts`. It calls
`Server.listen({ port: 4096, hostname: '127.0.0.1', mdns: false })` with headless env
(`OPENCODE_DB=:memory:`, `OPENCODE_DISABLE_MDNS=1`, `NODE_ENV=production`). The eager
`Layer.buildWithMemoMap` built the full ~40-layer DAG: `fenceLayer` pulled
`Database.Service`, and the **real** `@effect/sql-sqlite-node` +
`drizzle-orm/node-sqlite` ran the 6 boot PRAGMAs (`journal_mode=WAL`, …) + **all ~24
migrations** against the `node:sqlite` sql.js shim (ADR-0065) **under `Effect.orDie`**
— a failed migration would have died the layer and rejected `Server.listen`; it did
not. `NodeHttpServer.layer` then bound the rifty `node:http` server into the port
registry, reporting a `TcpAddress`.

Two routes dispatched through the port registry returned **200**:
- `GET /global/health` → `200 {"healthy":true,"version":"local"}` — a **typed Effect
  `HttpApi` handler** executing per-request (route tree → no-op auth middleware →
  handler → schema-encode), not a static asset.
- `GET /doc` → `200` (306 KB real OpenAPI 3.1.0 spec) — proves the whole route tree
  built.

Prints `RIFTY_OPENCODE_BOOT_OK`, **passes green** under `RIFTY_RUN_OPENCODE_BOOT=1` (~warm).
Auth is a no-op because `OPENCODE_SERVER_PASSWORD` is unset (`ServerAuth.required()` is
false). This also demonstrates **Phase-2's core** (a real request→response through
Effect `HttpServer` over the rifty `node:http` bridge, ADR-0054). **Nothing was
stubbed** — in particular the predicted `ptyConnectApi` stub was **not needed**:
`Pty.defaultLayer` builds without constructing a native pty at layer-build (native pty
is lazy, per-connection). **ADR-0058 (boot builtin additions) resolves with NO new
public builtin surface required** — the boot called no unimplemented builtin/method;
recommendation A (harness-local env only) held.

## What is otherwise DEFERRED (and the exact gate for each)

With F01 done, Spike C decided, the shim built+wired+green, and GRAPH-LOAD + BOOT +
DB-READ all PASSED, the WASM-SQLite/drizzle irreversible decision is RESOLVED; the rest
are deferred process/wire-contract commitments downstream of boot.

| Deferred work | Gate to unblock |
|--------------|-----------------|
| **WASM-SQLite `node:sqlite` shim (features 03/04) — DONE (P2, RATIFIED, WIRED)** | **RATIFIED + shipped: ADR-0065.** Engine is **`sql.js`** (pure-JS WASM SQLite, SYNCHRONOUS API, in-memory-first), registered as a rifty **`node:sqlite` builtin** exposing a `DatabaseSync`-compatible synchronous surface (matches opencode's `OPENCODE_DB=:memory:` boot path and the `@effect/sql-sqlite-node` + `drizzle-orm/node-sqlite` `DatabaseSync` usage at the pinned SHA — see the ADR-0065 erratum). Built, parity-green vs Node 24, RangeError-overflow-hardened, **wired into the module loader** (proven by `sqlite-loader-roundtrip` conformance + the `sqlite-opencode-boot` gate). OPFS persistence DEFERRED (`Q-2026-05-31-301`). ADR-0065 SUPERSEDES decisions.md DRAFTS ADR-0055/0056. **No longer a blocker.** |
| **`node:diagnostics_channel` + the undici core builtin surface — CLEARED** | **DONE.** Was the graph-load LIVE wall; the `node:diagnostics_channel` builtin + the undici-driven surface behind it were registered in graph order during GRAPH-LOAD (`b425b05..ea846ef`). Graph fully loads. **No longer a blocker.** |
| **Headless server boot (feature 06) — DONE (BOOT gate PASSED)** | **DONE first attempt, zero walls** (see BOOT gate above). `Server.listen` boots headless, the eager DAG runs the real drizzle/sql.js PRAGMAs + ~24 migrations under `Effect.orDie`, `/global/health` + `/doc` return 200. **ADR-0058 resolves with NO new builtin surface** (boot called no unimplemented builtin/method); the predicted `ptyConnectApi` stub was not needed. A DB-read via a request followed in Phase 2 — see next row. |
| **DB-read via a request (Phase 2) — DONE (DB-READ gate PASSED)** | **DONE, zero walls.** `GET /session` drives the instance-context middleware (instance resolved from cwd `/workspace`), builds the lazy Session/Project/Workspace layers, runs a real drizzle `db.select().from(SessionTable)…all()` (session.ts:1079), returns `200 []` (empty, fresh in-memory DB). Migrated schema queryable end-to-end. FileWatcher (no native `@parcel/watcher`) and the `@npmcli/arborist` background install degrade gracefully — opencode logs+continues, request unaffected (see `../compat/opencode-tool-ceiling.md`). Gate: `tests/integration/opencode-dbread.opt-in.test.ts`. No new ADR (degradations sit on the already-drawn no-native-addon line). |
| **v3 SSE frame bump (feature 07)** | **ADR-0060 draft DEFERRED** — non-additive bump of a versioned wire contract (`PREVIEW_PORT_FRAME_VERSION` 2→3) that CONTRADICTS ADR-0048 D2 and ADR-0017's M12 deferral. Page-direct SSE (ADR-0055) ships first with no code. Gate: the Worker becomes the actual opencode owner (ADR-0046 `WorkerOwnerBinding`) AND a superseding ADR cites+supersedes ADR-0048 D2 and amends ADR-0017. |
| **LLM round-trip + `node:https`→fetch (feature 08) — WIRED + dry-run-verified; awaits a live endpoint** | **Harness built + dry-run-driven to the real API call** (`opencode-phase3-smoke.ts` + `opencode-llm.opt-in.test.ts`). C1 cleared: `ai@6` + `@ai-sdk/*` use `globalThis.fetch`, ZERO `https.Agent`/`node:https` touch (decisions.md "C1 PRE-FLIGHT RESULT") — `node:https` stays loud-throw, the ADR-0061 split is NOT required. A dry-run against an unreachable endpoint drove the FULL pipeline: `POST /session` → prompt → tool resolution → `llm.provider=oai-compat` → a real `fetch` POST to `/v1/chat/completions` with a valid OpenAI body, failing only on connection-refused. **3 general runtime walls cleared en route** (each parity-tested): `node:http` `STATUS_CODES`; `@riftydev/io` `Readable.setEncoding` (ADR-0069 — POST-body reads); `fs.statSync` `{ throwIfNoEntry: false }` (shell-tool probe). Added `@ai-sdk/openai-compatible@2.0.41` to the facade deps. Remaining: the **live round-trip** needs a provider + API key + endpoint via env (Q-2026-05-30-116, D-004) — a spend + external call (confirm-first). **ADR-0061** ratifies once the live call succeeds. |
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
   Phase 3 (LLM round-trip) 🟡 WIRED — dry-run drives POST /session → prompt → @ai-sdk/openai-
                                   │  compatible → real /v1/chat/completions POST (valid OpenAI body).
                                   │  3 runtime walls cleared (STATUS_CODES, setEncoding, statSync).
                                   ▼
   ►►► NEXT: run the live round-trip against a real endpoint+key (a spend; user-provided via env)
                     →  tool ceiling already marked (P5, shipped)
```

The original spine `vendor opencode → Spike C → WASM-SQLite decision` and the three
live gates after it (**GRAPH-LOAD**, **BOOT**, **DB-READ**) are all cleared. **Phase 3**
is **WIRED** (full prompt pipeline drove a real `/v1/chat/completions` POST, failing
only on the unreachable test endpoint). What remains: one **live** round-trip against a
real endpoint+key (user-provided via env — a spend); **ADR-0061** ratifies then. P5
(tool ceiling) is already marked.

## Single next unblocked step

**Run the Phase-3 LLM round-trip against a real endpoint.** Wiring is done and
dry-run-verified to a real `/v1/chat/completions` POST; the only remaining input is a
reachable OpenAI-compatible endpoint + key (user-provided via env — a spend + external
call, confirm-first):

```
RIFTY_OC_BASE_URL=https://host/v1 RIFTY_OC_API_KEY=sk-… RIFTY_OC_MODEL=gpt-4o-mini \
  RIFTY_RUN_OPENCODE_LLM=1 pnpm exec vitest run opencode-llm.opt-in
```

The smoke creates a session and sends a prompt with `model: { providerID, modelID }`
(a ModelRef object, not a string), setting the provider config via
`OPENCODE_CONFIG_CONTENT` + `OPENCODE_DISABLE_MODELS_FETCH=1`. **ADR-0061** (supersedes
immutable ADR-0010, preserving no-silent-plaintext) ratifies once the live call returns
a non-empty assistant reply.

## Links

- Decision register (full ADR-draft text + the reversible Q-block): [decisions.md](decisions.md)
- Retained feature designs (each cited by a ratified, immutable ADR's References
  section): [feature-02-ts-on-import-graph.md](feature-02-ts-on-import-graph.md)
  (ADR-0052/0053) · [feature-05-effect-http-bridge.md](feature-05-effect-http-bridge.md)
  (ADR-0054) · [feature-07-ws-sse-bridge.md](feature-07-ws-sse-bridge.md) (ADR-0055).
  The other 6 feature designs + the adversarial review + the execution log were
  consolidated into this doc (2026-05-31).
- Feasibility study: [`../opencode-rifty-feasibility-2026-05-30.md`](../opencode-rifty-feasibility-2026-05-30.md)
- Tool-execution boundary (compat source-of-truth): [`../compat/opencode-tool-ceiling.md`](../compat/opencode-tool-ceiling.md)
- GRAPH-LOAD gate harness (opt-in, PASSED): `tests/integration/opencode-graph-load.opt-in.test.ts`
- BOOT gate harness (opt-in, PASSED): `tests/integration/opencode-boot.opt-in.test.ts` +
  `tests/integration/fixtures/opencode-boot-smoke.ts`
- DB-READ gate harness (opt-in, PASSED, Phase 2): `tests/integration/opencode-dbread.opt-in.test.ts` +
  `tests/integration/fixtures/opencode-dbread-smoke.ts`
- LLM round-trip gate harness (opt-in, WIRED — needs env creds, Phase 3):
  `tests/integration/opencode-llm.opt-in.test.ts` +
  `tests/integration/fixtures/opencode-phase3-smoke.ts`
- Shared realm builder for all four gates: `tests/integration/fixtures/opencode-vfs-harness.ts`
- `node:sqlite` `DatabaseSync` shim: `packages/net/src/sqlite/` (`engine.ts`,
  `database-sync.ts`, `statement-sync.ts`, `register-builtins.ts`); loader-wiring proof
  `tests/conformance/builtins/sqlite-loader-roundtrip.test.ts`; compat `../compat/sqlite.md`
- Ratified ADRs: [0052](../adr/0052-ts-on-import-transform-hook.md) ·
  [0053](../adr/0053-ts-tsx-first-class-resolvable-extensions.md) ·
  [0054](../adr/0054-effect-consumes-node-http-as-is.md) ·
  [0055](../adr/0055-opencode-sse-streaming-http-no-ws-shim.md) ·
  [0065](../adr/0065-node-sqlite-databasesync-wasm-shim.md) (WASM-SQLite `node:sqlite`
  shim — supersedes decisions.md DRAFTS ADR-0055/0056) ·
  [0069](../adr/0069-readable-set-encoding.md) (`Readable.setEncoding` — POST-body reads
  on the Phase-3 path)
