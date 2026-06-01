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
- 🟡 **Phase 3 — session + one LLM round-trip: HARNESS BUILT + dry-run-verified to
  the real API call; only a reachable endpoint+key remains.** C1 pre-flight cleared
  (ai-sdk uses `globalThis.fetch`, no `https.Agent`). A dry-run against an
  unreachable endpoint (`127.0.0.1:1`) drove the FULL pipeline: `POST /session` →
  prompt → tool resolution → provider select → `@ai-sdk/openai-compatible` →
  **a real outbound `fetch` POST to `/v1/chat/completions` with a valid OpenAI body**
  (model + max_tokens + the opencode system prompt + the user message), failing only
  on connection refused — exactly as expected with no real endpoint. **3 walls cleared
  on the way** (all general runtime parity, no opencode hardcode): `node:http`
  `STATUS_CODES`; `@rifty/io` `Readable.setEncoding` (ADR-0069 — every POST-with-body
  route needs it); `fs.statSync` `{ throwIfNoEntry: false }` (Node v24 parity — the
  shell-tool resolution probe).
- ▶️ **NEXT: run the live round-trip** — needs the user's provider + API key +
  endpoint via env (a spend + external call, confirm-first). See "Run the Phase-3
  gate" below.

## ►► NEXT: run the Phase-3 LLM round-trip against a real endpoint

Phases 1, 2, AND the Phase-3 *wiring* are all cleared — the harness drives the full
prompt pipeline to a real outbound `/v1/chat/completions` POST. The only thing left
is to point it at a reachable OpenAI-compatible endpoint with a valid key:

```
# the smoke reads creds from env (D-004 — never hardcoded); a spend + external call
RIFTY_OC_BASE_URL=https://host/v1 RIFTY_OC_API_KEY=sk-… RIFTY_OC_MODEL=gpt-4o-mini \
  RIFTY_RUN_OPENCODE_LLM=1 pnpm exec vitest run opencode-llm.opt-in
# or the smoke directly:
RIFTY_OC_BASE_URL=… RIFTY_OC_API_KEY=… RIFTY_OC_MODEL=… \
  npx tsx tests/integration/fixtures/opencode-phase3-smoke.ts
```

It sends `POST /session` then `POST /session/:id/message` with `model:
{ providerID, modelID }` (NOT a string — ModelRef is an object, prompt.ts:1681) and
asserts a non-empty assistant text. Provider config (`OPENCODE_CONFIG_CONTENT`) +
`OPENCODE_DISABLE_MODELS_FETCH=1` are set by the smoke. **ADR-0061 ratifies once the
live call succeeds** (the C1 result already reframed it: the client→fetch split is
optional, not required). Plan + what's already cleared (critical path):

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

### Phase 3 — session + 1 LLM round-trip (P4)  🟡 WIRED, awaits a live endpoint
- Harness: `tests/integration/fixtures/opencode-phase3-smoke.ts` + opt-in driver
  `tests/integration/opencode-llm.opt-in.test.ts` (gate `RIFTY_RUN_OPENCODE_LLM`).
- **C1 pre-flight DONE — CLEARED.** `ai@6.0.168` + `@ai-sdk/{provider-utils,gateway,
  provider}` issue requests via `globalThis.fetch` (`provider-utils/dist/index.mjs:588`)
  with ZERO `https.Agent`/`node:https` touch; opencode injects its own `fetch`
  (`provider/provider.ts:1618-1667`). `node:https` stays loud-throw; the ADR-0061
  client→fetch split is NOT required. Evidence: `decisions.md` "C1 PRE-FLIGHT RESULT".
- **3 walls cleared via dry-run** (against `127.0.0.1:1`, in eager order — all GENERAL
  runtime parity fixes):
  1. `node:http` `STATUS_CODES` — faithful Node map (opencode `provider/error.ts`
     error path). `@rifty/net`, parity `http/status-codes.case.ts`.
  2. `@rifty/io` `Readable.setEncoding` — **ADR-0069**. `@effect/platform-node`'s
     `NodeStream.toString` calls `setEncoding('utf8')` to read ANY POST body; without
     it `POST /session` 500s. Parity `stream/readable-set-encoding.case.ts`.
  3. `fs.statSync` `{ throwIfNoEntry: false }` — Node v24 parity. opencode's
     `Filesystem.stat` (shell-tool resolution `Filesystem.stat(shell)?.isFile()`)
     walled on the thrown ENOENT. `@rifty/runtime-js`, parity
     `fs/stat-throw-if-no-entry.case.ts`.
- **Dry-run RESULT (unreachable endpoint):** the full pipeline ran — `POST /session`
  201, prompt → tool resolution → `llm.runtime=ai-sdk llm.provider=oai-compat` → a
  real `fetch` POST to `http://127.0.0.1:1/v1/chat/completions` with a valid OpenAI
  body (model + max_tokens + system + user message), failing only with
  `AI_APICallError` (connection refused) after ai-sdk retries. So a REAL endpoint+key
  completes the round-trip. Run it with the command in "►► NEXT" above.
- **Provider dep:** `@ai-sdk/openai-compatible@2.0.41` is now KEEP-installed in
  `deps` (the one exception to "providers dropped" — see `fetch-opencode.mjs`).
- **Facade ceiling note:** the shell tool now RESOLVES (its `acceptable()` probe no
  longer throws), so it is listed to the LLM, but actually RUNNING it still hits the
  spawn ceiling (ENOENT-127) — fine for a plain text prompt that calls no tool.
- Note: boot/dbread runs already show `service=lsp all LSPs are disabled`,
  formatters disabled, and providers loading internal auth plugins cleanly — the
  provider/session machinery initialises headless; the only untested edge is the
  actual outbound `fetch` under a live key.

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

## Done — BOOT + DB-READ + Phase-3-wiring session (this session)
1. Extracted the shared realm builder
   `tests/integration/fixtures/opencode-vfs-harness.ts` (`buildOpencodeLoader`)
   out of the graph-load smoke + scaffolded the BOOT smoke/driver.
2. **BOOT gate (Phase 1)** ✅: `opencode-boot-smoke.ts` calls `Server.listen` +
   asserts `/global/health` (typed handler) + `/doc` → 200; driver
   `opencode-boot.opt-in.test.ts`. **ADR-0058 resolved as no-op** (no new builtin
   surface; no `ptyConnectApi` stub needed). Zero runtime changes.
3. **DB-READ gate (Phase 2)** ✅: `opencode-dbread-smoke.ts` → `GET /session` →
   real drizzle SELECT → `200 []`; driver `opencode-dbread.opt-in.test.ts`.
   FileWatcher/arborist graceful degradations recorded in
   `docs/compat/opencode-tool-ceiling.md`. Zero runtime changes.
4. **Phase-3 wiring** 🟡: C1 pre-flight (ADR-0061 "C1 PRE-FLIGHT RESULT"), then the
   `opencode-phase3-smoke.ts` + `opencode-llm.opt-in.test.ts` harness, dry-run-driven
   to a real `/v1/chat/completions` POST. Cleared **3 GENERAL runtime walls** (each
   TDD'd with a Node parity case, full parity suite re-run green — 64 cases):
   `node:http` `STATUS_CODES` (`@rifty/net`); `Readable.setEncoding` (`@rifty/io`,
   **ADR-0069**); `fs.statSync` `{ throwIfNoEntry: false }` (`@rifty/runtime-js`).
   Added the `@ai-sdk/openai-compatible@2.0.41` facade dep. Live round-trip awaits
   the user's endpoint+key.
All opt-in gates green; parity suite green (64/64); io stream unit tests green
(38/38); biome clean on changed files. No opencode-source edit. CHANGELOGs updated
in the three affected packages.

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
- Living current-state doc: `docs/opencode/README.md` (GRAPH-LOAD + BOOT + DB-READ
  PASSED; Phase-3 LLM round-trip WIRED, awaits a live endpoint).
- Decision register: `docs/opencode/decisions.md`. On-disk ADRs **0052–0055,
  0063–0069**. **ADR-0058** (headless boot) RESOLVED as no-op. **ADR-0069**
  (`Readable.setEncoding`). Draft awaiting ratification on the live call:
  **ADR-0061** (LLM https.Agent — C1 result: split optional, not required).
- Open questions: `Q-2026-05-31-301` (OPFS persistence), `-302` (sqlite builtin
  path), `-304` (decorators gap), `Q-2026-06-01-305` (auto tsconfig discovery),
  `-306` (configurable loader map + binary `.wasm` module loader).
- Gate harnesses: `tests/integration/opencode-{graph-load,boot,dbread,llm}.opt-in.test.ts`
  + `tests/integration/fixtures/opencode-{graph-load,boot,dbread,phase3}-smoke.ts`,
  sharing `tests/integration/fixtures/opencode-vfs-harness.ts`.
- `node:sqlite` sql.js shim (the boot exercised it — migrations ran green):
  `packages/net/src/sqlite/`. Spike C verdict + critical path: `README.md`.
- Vendored source: `tests/integration/fixtures/opencode/source`; deps manifest
  `…/opencode/deps/package.json` (+ `fetch-opencode.mjs` to regenerate). Pinned
  clone scratch (may be gone): `/tmp/opencode-vendor`.
- Memory: `opencode-target`, `running-real-packages-methodology`,
  `architecture-decision-pipeline` (auto-load).
