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
migrated at layer-build, not lazily. The no-vendored-tree slice remains green;
the next tree-dependent step (real graph-load, F02-T9) is now unblocked.

## What shipped (green)

All verified WITHOUT the vendored tree. Last full local verification on HEAD
`3890fc6`: typecheck PASS, `check:deps` PASS, `test:run` 867 passed / 16 skipped
/ 0 failed (the only red is pre-existing whole-tree `pnpm lint` debt in
`packages/npm-client/src/installer.ts`, unrelated to this effort).

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
  P0's tree-integration half (createRoutes smoke F02-T9) is still blocked on the
  vendored tree.

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
neither. ADR-0065 supersedes the decisions.md DRAFTS ADR-0055/0056. Caveat: no live
boot was run, so Spike C is static; it is robust because the acquire-time
`Database.Service` pull and the `Effect.orDie` migrations are unconditional.

## What is BLOCKED (and the exact gate for each)

With F01 done and Spike C decided, the remaining blockers are the
WASM-SQLite/drizzle irreversible decisions (now pulled to P2) plus the deferred
process/wire-contract commitments.

| Blocked work | Gate to unblock |
|--------------|-----------------|
| **WASM-SQLite `node:sqlite` shim (features 03/04) — NOW P2, RATIFIED** | **Spike C confirmed a real `Database` is constructed at layer-build (not lazy)**, so a throw-on-USE stub is no longer sufficient and the decision is PULLED FORWARD to P2. **RATIFIED: ADR-0065** — the engine is **`sql.js`** (pure-JS WASM SQLite, SYNCHRONOUS API, in-memory-first), registered as a rifty **`node:sqlite` builtin** exposing a `DatabaseSync`-compatible synchronous surface (matches opencode's `OPENCODE_DB=:memory:` boot path and `@effect/sql-sqlite-node`'s `DatabaseSync` usage at the pinned SHA). OPFS persistence via `@sqlite.org/sqlite-wasm` + `SyncAccessHandle` is DEFERRED (Q-2026-05-31-301). The shim honors `:memory:`, tolerates/no-ops `PRAGMA journal_mode=WAL`, and runs the ~24 migration DDL. The `bun:sqlite`-intercept framing is CORRECTED to `node:sqlite` (rifty resolves under the `node` condition); the `#db` import map is a red herring (its targets don't exist at this SHA and nothing imports `#db`). ADR-0065 SUPERSEDES the decisions.md DRAFTS ADR-0055 (engine) + ADR-0056 (drizzle adapter — void at this SHA: opencode uses `@effect/sql-sqlite-node` over `node:sqlite`, not drizzle). **In progress:** F01 siblings are being completed and the shim is being built. |
| **Headless server boot (feature 06)** | Needs the vendored tree to boot `Server.listen` headlessly. **ADR-0058 draft DEFERRED** — nothing concrete to ratify (`os.hostname()` already exists; the substance is a process commitment). Gate: a real boot surfaces a CONCRETE unimplemented builtin via a loud throw → open a fresh, specific ADR for the named method then. |
| **v3 SSE frame bump (feature 07)** | **ADR-0060 draft DEFERRED** — non-additive bump of a versioned wire contract (`PREVIEW_PORT_FRAME_VERSION` 2→3) that CONTRADICTS ADR-0048 D2 and ADR-0017's M12 deferral. Page-direct SSE (ADR-0055) ships first with no code. Gate: the Worker becomes the actual opencode owner (ADR-0046 `WorkerOwnerBinding`) AND a superseding ADR cites+supersedes ADR-0048 D2 and amends ADR-0017. |
| **LLM round-trip + `node:https`→fetch (feature 08)** | Needs the vendored tree, a live provider endpoint via env (Q-2026-05-30-116, D-004), and features 01-06. **ADR-0061 draft DEFERRED** (supersedes immutable ADR-0010). Gate: clear the **C1 pre-flight** — inspect pinned `ai@6`/`@ai-sdk/*` source for whether the global-`fetch` path constructs an `https.Agent` at init (a thrown Agent constructor would be init-time-fatal for the round-trip). Run the live flow with `node:https` left as loud-throw FIRST; adopt the client→fetch split only if it actually trips. The superseding ADR must preserve ADR-0010's no-silent-plaintext invariant. |
| **Real ripgrep/git tool fidelity (feature 09, future)** | **ADR-0062 draft is a DEFERRAL tripwire** — adopting ripgrep-WASM / isomorphic-git / wa-sqlite-search (each a NEW external dep) is BLOCKED until a concrete measured need. The pure-JS marker shipped under Q-2026-05-30-061. Do not silently cross this. |

## Critical path

```
vendor opencode (F01) ✅  →  Spike C ✅ (verdict: eager Database)  →  WASM-SQLite is P2 (ADR-0065 RATIFIED: sql.js)
        │ DONE e8be3b2              │ DONE (static)                           │
        └────────────────────────  spine resolved  ───────────────────────────┘
                                   │
   next (unblocked): real graph-load smoke (F02-T9) — import { Server } against the vendored tree,
                     assert layer-build reaches Database (live confirmation of Spike C)
                                   │
   then: node:sqlite sql.js shim lands in P2  →  headless boot (F06)  →  first route (P3)
                     →  session + 1 LLM round-trip (P4, after C1 https.Agent pre-flight)
                     →  tool ceiling already marked (P5, shipped)
```

`vendor opencode → Spike C → WASM-SQLite decision` was the spine; **all three
gates are now cleared.** Spike C's make-or-break call landed on
**pull-forward**: the irreversible WASM-SQLite dependency is a **P2 boot
prerequisite, not a deferred P4 need**, and the engine is now RATIFIED
(**ADR-0065**: `sql.js`, in-memory-first `node:sqlite` `DatabaseSync` shim;
OPFS persistence deferred). P4 additionally holds on the C1 `https.Agent`
pre-flight. P5 (the tool ceiling) is already marked.

## Single next unblocked step

**F02-T9 — real graph-load smoke.** Now that the tree is vendored and resolves
(470 internal files, 0 unresolved; 327 npm packages via `npm ci`), the immediate
move is to `import { Server }` from
`tests/integration/fixtures/opencode/source/packages/opencode/src/server/server.ts`
in a rifty integration harness and drive the layer build — turning Spike C's
static verdict into a **live** observation: confirm the layer DAG reaches
`Database` construction at build time (it should die on a throw-stub exactly as
predicted). That live failure is the concrete trigger to ratify **ADR-0055**
(WASM-SQLite) for P2. Doing the live load first (rather than ratifying on static
analysis alone) keeps the irreversible dep honest — proven-needed, not
assumed-needed.

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
- Ratified ADRs: [0052](../adr/0052-ts-on-import-transform-hook.md) ·
  [0053](../adr/0053-ts-tsx-first-class-resolvable-extensions.md) ·
  [0054](../adr/0054-effect-consumes-node-http-as-is.md) ·
  [0055](../adr/0055-opencode-sse-streaming-http-no-ws-shim.md) ·
  [0065](../adr/0065-node-sqlite-databasesync-wasm-shim.md) (WASM-SQLite
  `node:sqlite` shim — supersedes decisions.md DRAFTS ADR-0055/0056)
