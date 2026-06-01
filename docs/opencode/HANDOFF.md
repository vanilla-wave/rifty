# opencode → rifty — SESSION HANDOFF (2026-06-01)

> Temporary resume doc for continuing in a fresh session. Delete once absorbed.
> Everything below is **committed to `main`** (tree clean at HEAD `7a4e9a8`) —
> there is NO uncommitted code to recover. This file is the *state of the effort*.

## TL;DR
Booting `anomalyco/opencode`'s Effect server headless inside rifty as a
no-tool-execution facade. We're in the **graph-load → `Server.listen` first-light**
integration: load opencode's real module graph through rifty's loader, then boot.

**Do NOT run the iterate-builtins loop as a `Workflow`.** Its agents keep tripping
the **180s no-output watchdog** (killed the whole workflow twice) whenever an
iteration runs a long silent command. Each iteration commits before dying, so no
work was lost — but the harness is the wrong tool. **Drive the loop from the MAIN
session instead** (background smoke + one short focused subagent per wall).

## How to run the gate (the graph-load smoke)
```
RIFTY_RUN_OPENCODE_GRAPH_LOAD=1 pnpm exec vitest run tests/integration/opencode-graph-load.opt-in.test.ts
```
- Run with **sandbox disabled** (needs the deps) and **in background** (re-invokes on
  completion, no watchdog). Warm run is **~5s** (strip disk-cache at
  `/tmp/rifty-opencode-strip-cache`).
- It is **opt-in** (env-gated) and **skips-with-reason = green** when blocked,
  printing to stderr:
  `[opencode-graph-load] GATE blocked, skipping: <THE EXACT WALL>`
  Read that line for the current wall. It never fakes a pass.

## ►► GRAPH-LOAD GATE: ✅ PASSED (the session's target)
```
[opencode-graph-load] GRAPH LOADED — Server.listen is function
[opencode-graph-load] RIFTY_OPENCODE_GRAPH_LOAD_OK
```
The real opencode `Server` import now **resolves + evaluates the whole ~900-file
server graph** and exposes `Server.listen` as a function. The opt-in gate
(`opencode-graph-load.opt-in.test.ts`) passes **green (genuine OK, not
skip-with-reason)** under `RIFTY_RUN_OPENCODE_GRAPH_LOAD=1` (~8s warm). Last walls
were a short tail of missing llm-provider npm deps added to the facade manifest:
`@smithy/eventstream-codec` + `@smithy/util-utf8` (ba609e0), `aws4fetch` (ea846ef).

## ►► NEXT WALL (start here): the BOOT gate (`Server.listen` first light)
The graph LOADS but is not yet BOOTED. Next is handoff step 6: extend the harness
to call `Server.listen(opts)` headless (mDNS off via `OPENCODE_DISABLE_MDNS=1`,
`OPENCODE_DB=:memory:`, stub `ptyConnectApi`). This eagerly builds the ~40-layer
DAG → `fenceLayer` pulls `Database.Service` → the **real `@effect/sql-sqlite-node`
+ drizzle layer** runs PRAGMAs + ~24 migrations against the `node:sqlite` sql.js
shim (ADR-0065). Assert boot + a trivial route → 200 JSON. Expect the FIRST
eager-layer-build failures here (a concrete unimplemented builtin/method via a loud
throw, or a Database-construction edge) — open a fresh, specific ADR per named gap.

## ►► PROGRESS THIS SESSION (2026-06-01, 14 commits on `main`, b425b05..d26cf17)
Walked the live graph-load walls in order — each fix TDD'd (parity case where a
Node baseline exists, else conformance), full `pnpm test:run` green after each
load-bearing change (948 tests), biome clean, ADR for each irreversible decision:
1. **`@/` tsconfig path aliases** → opt-in `paths` resolver option (**ADR-0066**).
2. **file-before-directory** resolution (Node `LOAD_AS_FILE` order) — `./migration`.
3. **ESM self-namespace** `export * as X from "."` — `rebuildExports` mutates in
   place so the captured self-ref stays live (unblocks `EffectDrizzleSqlite`).
4. **global-`Object` shadowing** — export codegen reaches the real `Object` via a
   mangled factory binding (`config/permission.ts`'s `export const Object`).
5. **`async_hooks.AsyncLocalStorage`** (synchronous-scope fidelity) — `LocalContext`.
6. **`node:stream/consumers`** builtin (buffer/text/json/arrayBuffer/blob).
7. **`node:timers/promises`** builtin (+ AbortSignal) — `setTimeout as sleep`.
8. **`node:http2`** loud-throw facade + real 240-entry `constants` — fastify/undici.
9. **CJS compile error** now names the module (diagnostic) — surfaced `generate.txt`.
10. **text-asset imports** `.txt/.sql/.md/.prompt` → contents (**ADR-0067**).
11. **`with { type: "file" }` file loader** → asset path (**ADR-0068**) — photon wasm.
12. **`@opentelemetry/resources`** facade dep (optional peer of `@effect/opentelemetry`).
Open questions added: `Q-2026-06-01-305` (auto tsconfig discovery), `-306`
(configurable loader map + binary `.wasm` *module* loader). The
`Server.listen` BOOT gate is still unreached (more provider-dep walls first).

## The loop mechanism that WORKS (use this)
1. Run the smoke in background (sandbox off). Read `GATE blocked, skipping: <wall>`.
2. Fix exactly that wall:
   - **Missing Node builtin** → implement faithfully in
     `packages/runtime-js/src/builtins/` (real Node semantics; a **loud-throw facade**
     ONLY for genuine browser ceilings like UDP/raw-TCP/TLS — it just needs to
     *evaluate*, not function), register in the `@rifty/io` builtin registry, add a
     parity case under `tools/node-parity-runner/cases/<mod>/`.
   - **opencode-internal module** (`@/…`) → vendor the missing file or fix the
     resolver alias/index edge.
3. **Verify FAST** (this is what avoids the stall): the **smoke advancing past the
   wall IS the integration signal**; plus biome on changed files + at most ONE
   targeted `vitest run <file>`. **Do NOT** run full `pnpm test:parity` or
   whole-workspace `pnpm typecheck` per iteration — those silent multi-minute runs
   are what tripped the watchdog.
4. Commit one concept, one-line message, **NO Co-Authored-By**, **on `main`**.
5. Repeat until the smoke prints the full-load success (Server.listen exposed).
6. Then attempt the **BOOT gate**: extend the harness to call `Server.listen(opts)`
   headless (mDNS off via `OPENCODE_DISABLE_MDNS=1`, `OPENCODE_DB=:memory:`, stub
   `ptyConnectApi`). This eagerly builds the ~40-layer DAG → `fenceLayer` pulls
   `Database.Service` → the **real `@effect/sql-sqlite-node` + drizzle layer** runs
   PRAGMAs + ~24 migrations against the sql.js `node:sqlite` shim. Assert boot +
   a trivial route → 200 JSON. (This closes review finding #3: boot must exercise
   the REAL session/drizzle layer, not hand-written SQL.)
7. **At the very end** (once, not per-iteration): full `pnpm typecheck && pnpm
   check:deps && pnpm test:run` + biome. The opencode harness stays opt-in so it
   never reddens default CI.

## Done so far (all committed to `main`)
- **F01 vendored** opencode @ `f401f01` → `tests/integration/fixtures/opencode/source/packages/*`;
  217MB deps gitignored (`npm ci` in `…/opencode/deps/`); pin script
  `tools/shadow-registry/scripts/fetch-opencode.mjs`.
- **Spike C** → WASM-SQLite is a **P2 boot prerequisite** (eager `DatabaseSync` at
  layer-build), ratified **ADR-0065**.
- **`node:sqlite` `DatabaseSync` shim over sql.js** in `packages/net/src/sqlite/`
  (engine / database-sync / statement-sync / register-builtins), parity-green vs
  Node 24, **in-memory** (OPFS deferred, Q-2026-05-31-301).
  ⚠ ADR-0065 erratum: `drizzle-orm/node-sqlite` IS wired over this shim; the boot
  gate must use the real effect-sql+drizzle layer (not raw SQL).
- **TS-on-import** (ADR-0052/0053) + resolver fix for effect@4 `unstable/*` subpath
  exports (`a397f05`) carry the real **~900-file** graph through esbuild.
- **Builtins added to clear the undici/effect/mDNS surface** (graph now past it):
  `node:diagnostics_channel` (f043596), `node:util.debuglog` (4c5203e),
  `node:console` (ed0e1fc), `node:util/types` (a8e566e),
  `node:worker_threads` markers (78d742d), `node:dgram` facade (7a4e9a8);
  + `util.format('%s')` fix (553f079).
- Harness: `tests/integration/opencode-graph-load.opt-in.test.ts` +
  `tests/integration/fixtures/opencode-graph-load-smoke.ts`.

## Expected remaining tail
After `@/account/account`, expect more opencode-internal `@/…` modules + possibly a
few more Node builtins undici/effect pull (`net`/`tls`/`zlib`/`perf_hooks`/
`async_hooks`). Genuine browser ceilings (UDP/raw-TCP/TLS) = loud-throw facades that
only need to EVALUATE (boot disables mDNS; outbound undici/HTTP-client isn't used at
boot). The opencode server itself uses `node:http` SERVER, which rifty already
bridges. So the path to first-light is a tail of small, graph-ordered fixes.

## Rules in effect (don't re-litigate)
- **ADR-0063 / 0064** (D-008/009): record-and-continue; **inflections are not stops**
  (a plan-changing result / a now-verified dependency need / a stale-assumption
  correction → decide, record via ADR or OPEN_QUESTIONS, continue, report after).
  A **decision subagent** is only for reconsidering an already-recorded decision.
  Confirm-first only for outward/destructive-beyond-repo actions.
- **Never modify a test to make code pass.** No silent stubs (NotImplementedError +
  compat entry). Strict top-down layers, no reverse imports, no `any`.
- **Commit to `main` directly** (you, the user, directed all work onto `main` this
  session — this overrides "branch-first-on-default"; tell subagents explicitly,
  they've wrongly branched off `main` twice).
- Pre-existing whole-tree lint failure in `packages/npm-client/src/installer.ts`
  (commit `bc6735e`) is NOT this work — biome changed-files only.

## Pointers
- Living current-state doc: `docs/opencode/README.md`
- Decision register: `docs/opencode/decisions.md`; ADRs **0052–0055, 0063–0065**.
- Open questions: `Q-2026-05-31-301` (OPFS persistence), `-302` (sqlite builtin module
  path), `-304` (decorators gap in TS-on-import).
- Feasibility origin: `docs/opencode-rifty-feasibility-2026-05-30.md`
- Pinned clone scratch (still on disk): `/tmp/opencode-vendor`
- Memory: `opencode-target` (auto-loads), `architecture-decision-pipeline`.
