# opencode → rifty — SESSION HANDOFF (rewritten 2026-06-01)

> Cold-start resume doc. Everything below is **committed to `main`** (tree clean).
> Read this + `docs/opencode/README.md` + the ADRs it points to; do NOT assume prior
> chat context.

## TL;DR — where we are
Booting `anomalyco/opencode` (Effect/Bun TS server, vendored fixture) headless in
rifty as a no-tool-execution facade.

- ✅ **GRAPH-LOAD gate PASSED** — the real `Server` import resolves + evaluates the
  whole ~900-file server graph and exposes `Server.listen` as a function.
- ✅ **BOOT gate PASSED (2026-06-01, this session) — zero walls.** `Server.listen`
  boots headless: the eager ~40-layer DAG builds, the real drizzle/sql.js layer
  runs the PRAGMAs + ~24 migrations under `Effect.orDie`, and `GET /global/health`
  (a typed Effect handler → `{"healthy":true}`) + `GET /doc` (306 KB OpenAPI)
  return **200**. Opt-in gate genuinely green. Spike C's eager-`Database`
  prediction is live-confirmed. **Nothing stubbed** — the predicted `ptyConnectApi`
  stub was not needed; **ADR-0058 resolves with NO new builtin surface**.
- ✅ **DB-READ gate PASSED (2026-06-01, this session) — zero walls.** `GET /session`
  drives the instance-context middleware (instance resolved from cwd `/workspace`),
  builds the lazy Session/Project/Workspace layers, and runs a real drizzle
  `db.select().from(SessionTable)…all()` → `200 []` (empty, fresh DB). The migrated
  schema is queryable end-to-end. FileWatcher (no native `@parcel/watcher`) +
  `@npmcli/arborist` background install degrade gracefully (opencode logs+continues;
  request unaffected) — documented in `docs/compat/opencode-tool-ceiling.md`.
- ▶️ **NEXT: Phase 3** — create a session + one LLM round-trip. Not started.

## ►► NEXT WALL: Phase 3 — session create + 1 LLM round-trip

Phase 1 (Server.listen first light), the core of Phase 2 (request→response through
Effect `HttpServer` over rifty's `node:http`, ADR-0054), AND the DB-read half of
Phase 2 (a request that QUERIES drizzle) are ALL cleared. What remains is the agent
round-trip. Plan (critical path):

### Phase 1 — Server.listen first light  ✅ DONE (this session)
- Harness: `tests/integration/fixtures/opencode-boot-smoke.ts` + opt-in driver
  `tests/integration/opencode-boot.opt-in.test.ts`. `Server.listen` booted clean,
  `/global/health` + `/doc` → 200, clean `listener.stop(true)`. Eager
  `fenceLayer` → `Database.Service` ran 6 PRAGMAs + ~24 migrations against the
  sql.js shim (ADR-0065). Auth no-op (`OPENCODE_SERVER_PASSWORD` unset).

### Phase 2 — DB-read route + first request→response  ✅ DONE (this session)
- Harness: `tests/integration/fixtures/opencode-dbread-smoke.ts` + opt-in driver
  `tests/integration/opencode-dbread.opt-in.test.ts`. `GET /session` → `200 []`
  via a real drizzle SELECT (session.ts:1079), driving the instance context + lazy
  Session/Project/Workspace layers. Predicted native walls (FileWatcher / arborist)
  degraded gracefully — NOT walls (`docs/compat/opencode-tool-ceiling.md`). No new
  ADR (the degradations sit on the already-drawn no-native-addon line).

### Phase 3 — session + 1 LLM round-trip (P4, most uncertain)  ← START HERE
- `POST /session` (create) then a prompt driving ONE LLM call over `fetch`.
- **C1 pre-flight FIRST:** inspect pinned `ai@6` / `@ai-sdk/*` source — does the
  global-`fetch` path construct an `https.Agent` at init? (Would be init-fatal.)
  Run with `node:https` left as loud-throw FIRST; adopt a client→fetch split ONLY
  if it actually trips. **ADR-0061 draft** (supersedes immutable ADR-0010 — must
  preserve its no-silent-plaintext invariant) ratifies here.
- Live provider endpoint via **env** (D-004 — no hardcoded URLs).
- Note: the boot/dbread runs already showed `service=lsp all LSPs are disabled`,
  `all formatters are disabled`, and providers loading internal auth plugins — so
  the provider/session machinery initialises cleanly headless; the open question is
  the actual outbound `fetch`/`https.Agent` path under a live key.

### Phase 4 — tool ceiling (P5) — already shipped
- spawn/PTY/native git/ripgrep throw the documented ceiling
  (`docs/compat/opencode-tool-ceiling.md`). No new work unless reviving a read-only
  tool.

## How to run the gates (the smokes)
```
# GRAPH-LOAD gate (PASSED)
RIFTY_RUN_OPENCODE_GRAPH_LOAD=1 pnpm exec vitest run tests/integration/opencode-graph-load.opt-in.test.ts
# BOOT gate (PASSED) — Server.listen first light
RIFTY_RUN_OPENCODE_BOOT=1 pnpm exec vitest run tests/integration/opencode-boot.opt-in.test.ts
# DB-READ gate (PASSED) — GET /session reads drizzle; the closest model for a Phase-3 smoke
RIFTY_RUN_OPENCODE_DBREAD=1 pnpm exec vitest run tests/integration/opencode-dbread.opt-in.test.ts
```
- Run **sandbox-disabled** (needs the deps) and **in background** (re-invokes on
  completion, no watchdog). Warm run ~8s. Prints `RIFTY_OPENCODE_{GRAPH_LOAD,BOOT,DBREAD}_OK`
  on success, or `GATE blocked, skipping: <wall>` (skip = green, never fakes a pass).
- For the full uncaught stack, run a smoke script directly (sandbox off):
  `npx tsx tests/integration/fixtures/opencode-dbread-smoke.ts` (or `…-boot-smoke.ts`,
  `…-graph-load-smoke.ts`).
- All three smokes share the realm builder `opencode-vfs-harness.ts`
  (`buildOpencodeLoader`) — a Phase-3 smoke should fork `opencode-dbread-smoke.ts`.
  Strip-cache at `/tmp/rifty-opencode-strip-cache` makes warm runs fast.

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

## Done — BOOT + DB-READ gate session (this session)
Both the BOOT gate AND the Phase-2 DB-READ gate cleared with **zero runtime
changes** — the graph-load work already laid every builtin both paths need. New
code is **test harness only** (3 commits on `main`):
1. Extracted the shared realm builder
   `tests/integration/fixtures/opencode-vfs-harness.ts` (`buildOpencodeLoader`)
   out of the graph-load smoke + scaffolded the BOOT smoke/driver.
2. **BOOT gate:** `opencode-boot-smoke.ts` calls `Server.listen` + asserts
   `/global/health` (typed handler) + `/doc` → 200; driver
   `opencode-boot.opt-in.test.ts`. **ADR-0058 resolved as no-op** (no new builtin
   surface; no `ptyConnectApi` stub needed).
3. **DB-READ gate (Phase 2):** `opencode-dbread-smoke.ts` issues `GET /session`
   → real drizzle SELECT → `200 []`; driver `opencode-dbread.opt-in.test.ts`.
   Recorded the FileWatcher/arborist graceful degradations in
   `docs/compat/opencode-tool-ceiling.md`. No new ADR.
All three opt-in gates pass green (verified via `vitest run`). No new dep, no
public API change, no opencode-source edit, biome clean on changed files.

## Done — GRAPH-LOAD session (prior, 17 commits on `main`, b425b05..f29c22e)
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
- Living current-state doc: `docs/opencode/README.md` (GRAPH-LOAD + BOOT + DB-READ = PASSED).
- Decision register: `docs/opencode/decisions.md`. On-disk ADRs **0052–0055,
  0063–0068**. **ADR-0058** (headless boot) RESOLVED as no-op (no new builtin
  surface). Draft awaiting ratification: **ADR-0061** (LLM https.Agent — Phase 3).
- Open questions: `Q-2026-05-31-301` (OPFS persistence), `-302` (sqlite builtin
  path), `-304` (decorators gap), `Q-2026-06-01-305` (auto tsconfig discovery),
  `-306` (configurable loader map + binary `.wasm` module loader).
- Gate harnesses: `tests/integration/opencode-{graph-load,boot,dbread}.opt-in.test.ts`
  + `tests/integration/fixtures/opencode-{graph-load,boot,dbread}-smoke.ts`, sharing
  `tests/integration/fixtures/opencode-vfs-harness.ts`.
- `node:sqlite` sql.js shim (the boot exercised it — migrations ran green):
  `packages/net/src/sqlite/`. Spike C verdict + critical path: `README.md`.
- Vendored source: `tests/integration/fixtures/opencode/source`; deps manifest
  `…/opencode/deps/package.json` (+ `fetch-opencode.mjs` to regenerate). Pinned
  clone scratch (may be gone): `/tmp/opencode-vendor`.
- Memory: `opencode-target`, `running-real-packages-methodology`,
  `architecture-decision-pipeline` (auto-load).
