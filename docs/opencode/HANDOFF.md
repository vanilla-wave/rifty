# opencode → rifty — SESSION HANDOFF (rewritten 2026-06-01)

> Cold-start resume doc. Everything below is **committed to `main`** (tree clean).
> Read this + `docs/opencode/README.md` + the ADRs it points to; do NOT assume prior
> chat context.

## TL;DR — where we are
Booting `anomalyco/opencode` (Effect/Bun TS server, vendored fixture) headless in
rifty as a no-tool-execution facade.

- ✅ **GRAPH-LOAD gate PASSED** — the real `Server` import resolves + evaluates the
  whole ~900-file server graph and exposes `Server.listen` as a function. Opt-in
  gate is genuinely green (not skip-with-reason).
- ▶️ **NEXT: the BOOT gate** — actually call `Server.listen()` and serve one route.
  Not started.

## ►► NEXT WALL: the BOOT gate (`Server.listen` first light)

The graph LOADS but is not yet BOOTED. This is the plan, in phases (critical path):

### Phase 1 — Server.listen first light  ← START HERE
- **New harness code** (not just wall-fixes): after the graph loads, call
  `Server.listen(opts)` headless — env `OPENCODE_DISABLE_MDNS=1`,
  `OPENCODE_DB=:memory:`, `NODE_ENV=production`; stub `ptyConnectApi`. Extend
  `tests/integration/fixtures/opencode-graph-load-smoke.ts` (or a sibling
  `opencode-boot-smoke.ts`) + an opt-in driver, same shape as the graph-load gate.
- This **eagerly builds the ~40-layer DAG** → `fenceLayer` pulls `Database.Service`
  → real `@effect/sql-sqlite-node` + `drizzle-orm/node-sqlite` run PRAGMAs
  (`journal_mode=WAL`, …) + **~24 migrations** against the `node:sqlite` **sql.js**
  shim (ADR-0065). This is the eager-`Database` construction Spike C predicted.
- **Where to expect the first failures (walk them in eager-build order):**
  - sql.js shim handling of the boot PRAGMAs (tolerate/no-op `journal_mode=WAL`).
  - drizzle's `DatabaseSync` usage: `prepare().all/.get/.run`, `setReturnArrays`,
    `exec`; per ADR-0065 erratum the boot path is `setReadBigInts(false)` (plain
    number reads) — `setReadBigInts(true)` is an allowed directed throw.
  - the migration DDL actually running (`CREATE TABLE` / `INSERT` / `SELECT`).
  - then concrete unimplemented builtins/methods via loud throws — fix each
    faithfully (real Node semantics; loud-throw facade ONLY for genuine browser
    ceilings), ADR per named gap. **ADR-0058 draft (headless boot) ratifies here.**
- **Done:** server boots + a trivial route → 200 JSON, exercising the REAL
  session/drizzle layer (not hand-written SQL).

### Phase 2 — first route (P3)
- Assert a real request→response through Effect `HttpServer` over rifty's
  `node:http` bridge (ADR-0054, already shipped) + page-direct SSE (ADR-0055).
  Likely small.

### Phase 3 — session + 1 LLM round-trip (P4, most uncertain)
- **C1 pre-flight:** inspect pinned `ai@6` / `@ai-sdk/*` source — does the
  global-`fetch` path construct an `https.Agent` at init? (Would be init-fatal.)
  Run with `node:https` left as loud-throw FIRST; adopt a client→fetch split ONLY
  if it actually trips. **ADR-0061 draft** (supersedes immutable ADR-0010 — must
  preserve its no-silent-plaintext invariant).
- Live provider endpoint via **env** (D-004 — no hardcoded URLs).

### Phase 4 — tool ceiling (P5) — already shipped
- spawn/PTY/native git/ripgrep throw the documented ceiling
  (`docs/compat/opencode-tool-ceiling.md`). No new work unless reviving a read-only
  tool.

## How to run the gate (the smoke)
```
RIFTY_RUN_OPENCODE_GRAPH_LOAD=1 pnpm exec vitest run tests/integration/opencode-graph-load.opt-in.test.ts
```
- Run **sandbox-disabled** (needs the deps) and **in background** (re-invokes on
  completion, no watchdog). Warm run ~8s. Prints `RIFTY_OPENCODE_GRAPH_LOAD_OK` on
  success, or `GATE blocked, skipping: <wall>` (skip = green, never fakes a pass).
- For the full uncaught stack, run the script directly:
  `npx tsx tests/integration/fixtures/opencode-graph-load-smoke.ts` (sandbox off).
- Strip-cache at `/tmp/rifty-opencode-strip-cache` makes warm runs fast.

## The loop that WORKS (use this)
Drive from the **MAIN session** (NOT inside one Workflow — long silent commands trip
the 180s no-output watchdog). Per wall: run smoke in background → read the exact
wall → fix exactly it → re-run. Verify FAST: the smoke advancing IS the integration
signal; add biome on changed files + ONE targeted `vitest run <file>`. Do NOT run
full `test:run`/`typecheck` per iteration — save those for the milestone-end DoD.
Commit one concept per wall, one-line message, NO Co-Authored-By, on `main`.
**Subagents/Workflows are useful for an ISOLATED heavy wall** (e.g. this session
diagnosed the ESM self-namespace bug with 3 parallel agents: internals / minimal
repro / Node-semantics) — but the wall-discovery itself is sequential.

Fix taxonomy: **missing Node builtin** → implement faithfully in
`packages/runtime-js/src/builtins/` + register via `@rifty/io` `registerBuiltin` +
add a parity case. **opencode-internal / resolver gap** → fix the resolver/loader
generally (never special-case opencode). **missing npm dep** → add to
`FACADE_DEPENDENCIES` in `tools/shadow-registry/scripts/fetch-opencode.mjs` AND
`deps/package.json`, then `cd …/opencode/deps && npm install`. **browser ceiling**
(raw socket/UDP/TLS/HTTP2) → loud-throw facade that only EVALUATES.

## Done this session (17 commits on `main`, b425b05..f29c22e) — GRAPH-LOAD cleared
All fixes are GENERAL runtime improvements (no opencode hardcode in the runtime);
each TDD'd, full `test:run` green after load-bearing changes (931 pass), ADR per
irreversible decision. Walls cleared in graph order:
1. `@/` tsconfig path aliases → opt-in `paths` resolver option (**ADR-0066**).
2. file-before-directory resolution (Node `LOAD_AS_FILE` order) — real parity bug.
3. ESM self-namespace `export * as X from "."` — `rebuildExports` mutates in place.
4. global-`Object` shadowing — export codegen reaches real `Object` via mangled bind.
5. `async_hooks.AsyncLocalStorage` (synchronous-scope fidelity; cross-await is a
   documented gap — no native async-context in the realm).
6. `node:stream/consumers` builtin. 7. `node:timers/promises` builtin (+AbortSignal).
8. `node:http2` loud-throw facade + real 240-entry `constants` (fastify/undici).
9. CJS compile error now names the module (diagnostic).
10. text-asset imports `.txt/.sql/.md/.prompt` → contents (**ADR-0067**).
11. `with { type: "file" }` file-loader → asset path (**ADR-0068**).
12. missing facade deps: `@opentelemetry/resources`, `@smithy/eventstream-codec` +
    `util-utf8`, `aws4fetch`.

Milestone DoD verified: `pnpm typecheck` PASS, `pnpm check:deps` PASS (no cycles),
`pnpm test:run` 931/0, biome clean on changed files (pre-existing whole-tree lint
debt in `npm-client/src/installer.ts` is NOT ours).

## Rules in effect (don't re-litigate)
- **ADR-0063/0064** (D-008/009): record-and-continue; inflections are not stops.
  IRREVERSIBLE → write an inline ADR; REVERSIBLE → `OPEN_QUESTIONS.md` + `TODO(ADR)`.
  A decision subagent ONLY to overturn an already-recorded decision.
- **Commit to `main` directly** (user directed all work onto `main`; tell subagents
  explicitly — they've wrongly branched off `main` before).
- Never modify opencode source (it's the fixture/eталон) or a test to pass code. No
  silent stubs (`NotImplementedError` + compat entry). Strict layers, no `any`.
- Honest grey zones to keep disclosed: text-extension set includes the opencode-ism
  `.prompt` (general mechanism, fixed list — `Q-2026-06-01-306` defers a
  configurable loader map); `http2`/`tls`/`dgram` are loud-throw facades not real
  impls; `AsyncLocalStorage` is sync-scope only.

## Pointers
- Living current-state doc: `docs/opencode/README.md` (GRAPH-LOAD section = PASSED).
- Decision register: `docs/opencode/decisions.md`. On-disk ADRs **0052–0055,
  0063–0068**. Drafts awaiting ratification: **ADR-0058** (headless boot — Phase 1),
  **ADR-0061** (LLM https.Agent — Phase 3).
- Open questions: `Q-2026-05-31-301` (OPFS persistence), `-302` (sqlite builtin
  path), `-304` (decorators gap), `Q-2026-06-01-305` (auto tsconfig discovery),
  `-306` (configurable loader map + binary `.wasm` module loader).
- Gate harness: `tests/integration/opencode-graph-load.opt-in.test.ts` +
  `tests/integration/fixtures/opencode-graph-load-smoke.ts`.
- `node:sqlite` sql.js shim (Phase 1 will exercise it hard):
  `packages/net/src/sqlite/`. Spike C verdict + critical path: `README.md`.
- Vendored source: `tests/integration/fixtures/opencode/source`; deps manifest
  `…/opencode/deps/package.json` (+ `fetch-opencode.mjs` to regenerate). Pinned
  clone scratch (may be gone): `/tmp/opencode-vendor`.
- Memory: `opencode-target`, `running-real-packages-methodology`,
  `architecture-decision-pipeline` (auto-load).
