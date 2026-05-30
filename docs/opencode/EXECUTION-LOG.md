# opencode facade M12 — execution log

Date: 2026-05-30
Branch: `opencode-facade-m12`

This log records the autonomous session that took the staged M12 proposal
(`docs/opencode/README.md` + `feature-01..09.md` + `decisions.md` + `review.md`)
from "designed, nothing ratified" to "the no-vendored-tree slice ratified,
implemented, reviewed, verified". opencode is **NOT vendored** in this repo;
everything below is the work that is reachable WITHOUT the vendored tree. The
boundary between "done now" and "still gated" is the spine of this log.

---

## (a) Decisions — ratified and deferred

### Ratified this session (4 of 11 ADR drafts)

These are the low-regret, premise-verified, needed-now decisions whose gates
cleared. The human delegated ratification authority for this session; I ratified
conservatively (only where the gating premise was actually verified) and deferred
everything premature, network-blocked, or dependent on the unvendored tree.

| ADR | Title | From draft | File | Reversibility note |
|-----|-------|------------|------|--------------------|
| **0052** | TS-on-import transform hook on `ModuleLoaderOptions` (injected esbuild, async, extension-keyed) | 0052 | [docs/adr/0052-ts-on-import-transform-hook.md](../adr/0052-ts-on-import-transform-hook.md) | IRREVERSIBLE rule 1 (public API); additive/optional; request shape `{source,id,loader,workspace}→Promise<string>` verified end-to-end by Spike A |
| **0053** | `.ts`/`.tsx` as first-class resolvable + ESM module extensions | 0053 | [docs/adr/0053-ts-tsx-first-class-resolvable-extensions.md](../adr/0053-ts-tsx-first-class-resolvable-extensions.md) | IRREVERSIBLE rules 1+4 (cross-package resolver behaviour + Node deviation); `.js` ordered first so plain-JS packages byte-unchanged |
| **0054** | Effect `@effect/platform-node` consumes rifty `node:http` AS-IS via additive shape-widening (no dedicated Effect HTTP adapter) | 0057 | [docs/adr/0054-effect-consumes-node-http-as-is.md](../adr/0054-effect-consumes-node-http-as-is.md) | IRREVERSIBLE rule 1 (the A-vs-B/C fork); commits to the cheapest-to-live-with NEGATIVE; pipe-sink DEFERRED (review M4 — `@rifty/io` untouched) |
| **0055** | opencode event stream rides SSE-over-streaming-HTTP; no `ws` shim (page-direct only) | 0059 | [docs/adr/0055-opencode-sse-streaming-http-no-ws-shim.md](../adr/0055-opencode-sse-streaming-http-no-ws-shim.md) | IRREVERSIBLE rule 1 (pins cross-package contract; bounds ADR-0048 scope); NEGATIVE commitment over a path that already streams |

**Slate renumber note (important for future cross-references).** The decision
slate ratified the SSE/Effect-HTTP drafts under *next-free* ADR numbers (0054,
0055), NOT under their `decisions.md` draft numbers (0057, 0059). The slot
`decisions.md` calls draft "ADR-0055" is the DEFERRED WASM-SQLite draft. Each ADR
file above states `ratifies decisions.md draft ADR-00NN` in its Status line to make
the mapping explicit; `decisions.md` draft 0055/0056 stay labelled DEFERRED.

### Deferred (7 drafts) — with the gate that unblocks each

| Draft | Title | Why deferred | Gate to revisit |
|-------|-------|--------------|-----------------|
| ADR-0054 (draft) | Per-load module resolution conditions (opt-in `bun`) | Converted to an OPEN_QUESTIONS entry, NOT ratified. All inputs converge on option C (shadow-registry package.json overlay), which leaves the resolver + ADR-0004 untouched and is REVERSIBLE — there is nothing irreversible to ratify. | A future feature must demonstrate, against the REAL vendored tree (Spike C / feature-04 `#db`), that an overlay is genuinely insufficient for programmatic condition control. Until then no public-API `conditions` field is added. |
| ADR-0055 (draft) | WASM-SQLite engine for the `#db` shim | IRREVERSIBLE on two triggers: new external WASM-SQLite engine (rule 2) + >100 lines adapter/persistence (rule 4). Not needed now (tier-A resolvable throw-on-USE stub unblocks P0/P2/P3 first-light). Gated on unverified Spike C. The draft's own evaluation (`@sqlite.org/sqlite-wasm` per ADR-0006 vs sql.js, + COI/SAB vs ADR-0002) is not yet written. | Spike C passes against the real vendored tree (createRoutes ~40 layers build with tier-A stub alone, NO `Database` constructed at module eval), AND the ADR adds the `@sqlite.org/sqlite-wasm`-vs-sql.js evaluation + COI/SAB analysis, AND the P4 persistence scope (Q-2026-05-30-114) is decided. None verifiable without the tree. |
| ADR-0056 (draft) | drizzle driver adapter (`drizzle-orm/sql-js`) | New external dep (rule 2); hard-coupled to the unratified 0055 engine choice; the subpath-remap mechanism (`drizzle-orm/bun-sqlite`→`drizzle-orm/sql-js`) cannot route through the existing package-level override engine and is undesigned. | (1) ADR-0055 ratifies the engine first; (2) Spike C confirms the drizzle subpath on the static graph; (3) the subpath-interception mechanism is designed. |
| ADR-0058 (draft) | runtime-js builtin surface additions for the Effect boot | Nothing concrete to ratify — the substance is a PROCESS commitment. Verified against the tree: `os.hostname()` already returns `'rifty'` and `networkInterfaces()` returns `{}`, so review M7's named gate is already closed. Honest-stub safety net already holds (unimplemented builtins throw `NotImplementedError`). | A real headless opencode boot (feature-06 T3) against the vendored tree surfaces a CONCRETE unimplemented builtin via a loud throw. Open a fresh, specific ADR for the named method then. |
| ADR-0060 (draft) | `PREVIEW_PORT_FRAME_VERSION` 2→3: incremental SSE over the page↔Worker bridge | IRREVERSIBLE: non-additive bump of a versioned wire contract (rule 3); CONTRADICTS ADR-0048 D2 ("page memory unchanged until M12") + ADR-0017's M12 deferral; spans page+worker (>100 lines, rule 4). Page-direct SSE (ratified 0055) ships SSE first with no v3. Gated on the Worker actually being the opencode owner (ADR-0046). | Worker becomes the actual opencode owner (`WorkerOwnerBinding`/ADR-0046) AND a superseding ADR is authored that cites+supersedes ADR-0048 D2, amends ADR-0017, and audits the in-repo `bridgeCrossRealmPreview` callers for the resolve-on-start semantics change. |
| ADR-0061 (draft) | `node:https` client (request/get) → fetch; server TLS stays loud-throw (supersedes ADR-0010) | IRREVERSIBLE: supersedes immutable ADR-0010 (rule 3) + changes a cross-package builtin shape (rule 1). Its own C1 pre-flight (does ai@6/@ai-sdk construct an `https.Agent` at provider init?) cannot be inspected — neither ai/@ai-sdk nor opencode is vendored. Likely dead weight: run the live flow with `node:https` left as loud-throw FIRST. | Clear C1 against the PINNED ai@6 provider source once vendored; THEN run the live P4 flow and adopt the split only if it actually trips `node:https`. A NEW superseding ADR (ADR-0010 immutable) preserving the no-silent-plaintext invariant, plus a parity case (needs the M1 parity-net-mode that landed this session). |
| ADR-0062 (draft) | Read-only tool substitutes: JS-first; ripgrep-WASM / isomorphic-git DEFERRED | The deferral IS the standing decision (a tripwire, not adopted). Three potential new external deps (ripgrep-WASM, isomorphic-git, wa-sqlite-search), each IRREVERSIBLE rule 2, BLOCKED until a concrete measured need. The pure-JS marker (F09) needs no ADR and shipped this session. | A concrete, measured need for real ripgrep flag/output fidelity or read-only git in the facade. Open a FRESH ADR then to choose among ripgrep-WASM (via `runWasi` like the vendored esbuild.wasm) vs isomorphic-git vs staying pure-JS. |

### OPEN_QUESTIONS entries opened (code landed this session)

`Q-2026-05-30-101..109, 117, 118, 119` — the reversible sub-decisions behind the
implemented tasks (listen overload, drain emission, pipe-sink-deferred, loader
selection / transform cache / single workspace root, condition overlay, pure-JS
grep marker, spawn-ceiling contract, tool-ceiling doc placement). These ride on top
of the ratified ADRs and are individually cheap to reverse.

---

## (b) Spike results — what each de-risked

All three spikes that gate **now-implementable** work PASSED. Spike C (the
make-or-break real-graph layer-build) is NOT in this set: it requires the vendored
opencode tree, which is absent, so it remains the headline blocker (see NEXT STEPS).

| Spike | Result | What it de-risked |
|-------|--------|-------------------|
| **A — TS-strip round-trip** | **PASS** | Wired the REAL pipeline `transformWithEsbuild(runWasi, esbuild.wasm, {loader:'ts', format:'esm'})` → `transformEsm()` → the `executeEsm` rewrite, over a 3-file `.ts` ESM graph with type annotations, an interface, and an enum. Ran green (cross-file computed value correct), proving esbuild's stripped/lowered output (incl. the enum self-referential IIFE) round-trips through the existing acorn rewrite. Retired the round-trip premise that gated ADR-0052/0053 (review M8 / P0 go/no-go). Caveat: validated the strip→rewrite→execute mechanism for a representative TS surface only — NOT decorators, top-level-await, or cycles. |
| **B — Effect req/res over net** | **PASS** | A throwaway `packages/net` test exercised the Effect-style consumption shape over the port registry with ZERO opencode/Effect dep. RESPONSE side works AS-IS at the buffered level (status/content-type/exact JSON bytes via `dispatchToPort`); REQUEST side works AS-IS (method/url/lowercased headers + a genuinely-drained Readable body). The ONLY P3-blocking gap was `listen({port,host},cb)` keying the registry by the options object (502 silent-bind trap). Retired the net-side half of unknown #2 → ratified ADR-0054. |
| **D — streaming probe** | **PASS** | Read-only verification: `ServerResponse.toResponse()` resolves the `Response` at header-flush (first `write()`/`end()`) with a live `ReadableStream` body, so a never-`end()`-ed SSE body streams incrementally over the SW→page page-direct path with NO new transport code. Confirmed the page↔Worker v2 path resolves only on `reply-stream-end` (which SSE never sends) → INDEFINITE HANG (sharper than the draft's 30s-timeout claim). Retired the page-direct streaming premise → ratified ADR-0055; confirmed the v3 bump (ADR-0060) is genuinely needed AND genuinely deferrable. |
| **C — real-graph layer-build** | **NOT RUN (blocked)** | Requires the vendored opencode tree (absent). This is the gate that decides whether the WASM-SQLite dep (ADR-0055 draft) is a P4 need or a pulled-forward P2 prerequisite. Until it runs, every "P3 first-light is cheap" claim and the WASM-SQLite/drizzle ADRs stay deferred. |

---

## (c) Features — implemented (with shas + evidence) vs not implemented

Commit range this session: `39bff6a..19dbeac` (8 commits). All are verifiable
WITHOUT the vendored opencode tree.

### Implemented

| Feature / task | Commit | Evidence (from impl report, independently re-verified by review) |
|----------------|--------|-------------------------------------------------------------------|
| **F05-T1** — `HttpServer.listen` options-object overload (Q-107) | `39bff6a` | RED first: registry keyed on the options object (`expected [{port:4097}] to include 4097`); bare-number test passed, isolating the gap to the options form. GREEN: net http suite 12/12; typecheck clean; `check:deps` no cycle. |
| **F05-T2** — no-handler `createServer` + `on('request')` buffered 200 JSON | `12edbd2` | Test-only (T1 already landed the routable port). RED proven by temporarily reverting T1's port extraction → `expected 502 to be 200`; server.ts then fully restored. GREEN: server.test.ts 4/4. |
| **F05-T3** — `ServerResponse` emits Node-style `'drain'` on `pull()` after a backpressured write, gated by `_needDrain` (Q-108) | `376e3cd` | RED: `expected [] to deeply equal ['drain']` (never emitted). GREEN after the `_needDrain`-gated emit: response.test.ts 4/4 incl. the negative (no spurious drain). `@rifty/io` untouched (review M4). |
| **F05-T5** — NEGATIVE upgrade-boundary lock (WS/SSE not silently consumed) | `faaaf8f` | Characterization lock of an already-absent property; RED proven by temporarily wiring a fake `assignSocket` (`expected true to be false`), then reverted (0 occurrences). Registered `http.Server` upgrade as not-supported in `docs/compat/m10-tooling.md`. |
| **F05-M1** — opt-in `@rifty/net` parity mode + real `node:http` server parity cases (review M1) | `8fe16b8` | RED: `node:http` unregistered on the rifty side (parity structurally unreachable). GREEN: `pnpm test:parity` 40/40; buffered + streaming-drain cases produce byte-identical Node-vs-rifty stdout against locked `expected` strings. `@rifty/net` added as an INTERNAL workspace dep of the tools/ harness (not a new external dep). |
| **F02-T1** — resolver: `.ts`/`.tsx` first-class resolvable + index files + `detectKind` by scope | `ef41164` | RED: `.ts`/`index.ts` MODULE_NOT_FOUND; `detectKind` returned `cjs` for a `.ts` under `type:module`. GREEN: resolver.test.ts 39/39; full conformance 253 passed / 8 skipped. Wrote ADR-0053. |
| **F02-T8** — regression guard: a package shipping both `index.ts` and `index.js` resolves `index.js` | `5ef51e0` | RED proven by temporarily flipping `INDEX_FILES` order (CJS-on-TS SyntaxError on the `.ts`), then reverted to zero net diff. GREEN: full conformance 254 passed / 8 skipped. |
| **F02-T2** — public option surface: `workspace?` + `transformSource?` on `ModuleLoaderOptions`; export `TransformSourceHook`; thread the hook into the ESM path | `19dbeac` | RED: TS2353 (fields absent) + spy never invoked. GREEN: module-loader 8/8; conformance regression 306 passed / 8 skipped; `check:deps` no cycle (type defined in `esm.ts`, re-exported by `loader.ts` to avoid a loader↔esm cycle). Wrote ADR-0052 + the missing 0052/0053 README rows. |

### NOT implemented this session — and why

| Feature | Blocking reason |
|---------|-----------------|
| **01 load-opencode-into-vfs** | opencode is NOT vendored (only `docs/opencode/` + a branch ref). Vendoring a pinned SHA + facade manifest is scripts/+fixtures (REVERSIBLE, Q-2026-05-30-101-vendor) but it is a network-gated dev-acquisition step, not autonomously verifiable. ALL downstream integration smokes (F02 T9, F05 T6, F06, F08) depend on it. |
| **03/04 — `#db`/`#pty` shims, tier B (WASM-SQLite + drizzle)** | Tier A (resolvable throw-on-USE stub) is REVERSIBLE but its make-or-break gate is Spike C, which needs the vendored tree. Tier B adds NEW external deps (sql.js/@sqlite.org/sqlite-wasm + drizzle-orm/sql-js) — DEFERRED (ADR-0055/0056 drafts), not ratified. The colon-key `bun:sqlite` round-trip RED test + the single-owner harness-local stub (review C4) belong to the vendored-tree harness work. |
| **06 headless-server-boot** | Needs the vendored tree to boot `Server.listen` headlessly and surface any genuinely-missing runtime-js builtin (ADR-0058 DEFERRED — no concrete gap; `os.hostname` already exists, review M7). The pre-flight static inventory + the bonjour-service module-scope native-UDP check both need the real tree. Gated on 01+02+03/04 + Spike C. |
| **07 ws-sse-bridge — v3 page↔Worker frame bump** | ADR-0060 DEFERRED (versioned-wire bump; contradicts ADR-0048 D2 / ADR-0017; >100 lines; gated on the Worker being the opencode owner). Page-direct SSE (ratified 0055) ships SSE first with no code. The opencode `/event` parity proof (T1) needs the vendored tree. |
| **08 llm-flow (P4 LLM round-trip + node:https→fetch)** | ADR-0061 DEFERRED behind the C1 ai-Agent pre-flight (uninspectable — ai/@ai-sdk/opencode unvendored). The live LLM proof needs the vendored tree, a live provider endpoint via env (Q-116, D-004), and features 01-06. Durable storage (review M2/Q-114) unsettled. |
| **09 — F09-T1..T5 (tool-ceiling marker)** | **Partly N/A: the slate ASSIGNED these to this session** as no-vendored-tree work (read-substitute parity, pure-JS `vfsGrep` + failure-mode contracts, spawn-ceiling conformance, the compat doc). The impl report returned only F05 + F02 tasks; **F09-T1..T5 were NOT delivered in the 8-commit range** and remain TODO for the next session (no blocker — they are net/runtime-js/docs-only and were simply not reached). See NEXT STEPS. |

> Honesty note: the implementation slate listed 18 tasks; the impl report delivered
> 8 (all of F05's no-opencode tasks + the resolver/option-surface half of F02). The
> F02 transform-execution tasks (T3 esm strip step, T4 CJS-require loud-throw, T5
> transform cache, T6 parity ts-esm kind, T7 the gold multi-file `.ts` parity case)
> and ALL of F09 were NOT reached. The ratified ADR-0052 explicitly requires the
> gold T7 parity case before P0 can be declared closed — that case is NOT yet
> landed.

---

## (d) Review outcome (5-lens adversarial review)

Four lenses ran (correctness, hard-rules, ADR-faithfulness, test-quality). Net
verdict: the committed slice is substantively correct and faithful; the defects are
one real code omission and bookkeeping/citation faithfulness.

### Critical

None found in the committed slice. (The original `review.md` C1-C4 concern the
vendored-tree work — ai-Agent pre-flight, Spike C, token-streaming, single-owner
sqlite stub — none of which is in this session's commits; C4's single-owner
constraint was respected by NOT editing the runtime-js builtins for sqlite.)

### Major

| # | Finding | Addressed? |
|---|---------|------------|
| Correctness-MAJOR | `.ts`/`.tsx` added to `DEFAULT_EXTENSIONS`/`INDEX_FILES` with **no `.d.ts` exclusion** — a subpath shipping only `foo.d.ts`/`index.d.ts` (no sibling `.js`) now resolves the declaration and tries to EXECUTE it (acorn SYNTAX_ERROR). Node's own strip-types loaders deliberately skip `.d.ts`. Independent of opencode; not covered by the both-exist guard or any test. | **NOT YET FIXED — open follow-up.** Recommend excluding `*.d.ts`/`.d.cts`/`.d.mts` from candidate matching + a conformance case, before relying on `.ts` resolution against real npm trees. Filed as a NEXT STEP. |
| ADR-faithfulness-MAJOR | Committed code (`server.test.ts:105`, net `CHANGELOG.md:15`) cites **"ADR-0055"** for the SSE/no-ws-shim boundary, but no `docs/adr/0055-*.md` existed and in `decisions.md` numbering 0055 is the DEFERRED WASM-SQLite draft → a reader resolved the citation to the opposite decision. | **ADDRESSED THIS SESSION.** Wrote `docs/adr/0055-opencode-sse-streaming-http-no-ws-shim.md` (ratifies draft 0059) + `docs/adr/0054-...` (ratifies draft 0057) + README rows. The committed "ADR-0055" citation now resolves to the correct, on-disk SSE/no-ws-shim ADR; the renumber mapping is documented in §(a) and in each ADR's Status line. |

Two further minor/info ADR-faithfulness findings (a dangling "ADR-0052 D5" comment
in `loader.ts:21` that should cite `Q-2026-05-30-203`/`106`; `decisions.md:53` still
labels 0053 "(draft)") are noted as low-priority bookkeeping follow-ups — NOT yet
corrected.

### Minor / info (not blocking, noted for follow-up)

- Parity runner permanently registers `node:http`/`node:net`/`node:https` into the
  process-wide `@rifty/io` builtin singleton (no `unregisterBuiltin`); teardown
  comment overstates per-case isolation — latent order-dependence, no current case
  trips it.
- Documented `.jsx` transform support is effectively dead code (resolver/`detectKind`
  never route `.jsx` into the ESM path) — code/docs disagree; out of opencode's
  `.ts`-only scope.
- CJS-`.ts` path feeds raw TS to `new Function` → generic SyntaxError rather than the
  directed `NotImplementedError` (consistent with the documented T4 deferral; not yet
  registered as a compat limitation).
- F05-T5 negative test has two decorative length-0 assertions (the assignSocket
  absence checks carry the real teeth); F02-T2 executed-value assertion is closer to
  documentation than verification (the call-count + arg assertions are load-bearing).

### Test-quality verdict (verbatim)

The reviewer re-ran every new test live (net 35, loader-transform 2, resolver
conformance 40, parity 40/40 incl. byte-identical Node-vs-rifty http stdout against
locked `expected` strings), independently reproduced RED for F05-T1/T2 and confirmed
every claimed-new surface was genuinely absent at base — RED claims credible, GREEN
trustworthy. The "two empty strings match" vacuity hole is genuinely closed by the
enforced `expected` field.

---

## (e) Verification outcome (full local verification, HEAD `19dbeac`)

Run from a clean working tree; `pnpm install` reported "Already up to date".

| # | Command | Result | Exit | Evidence |
|---|---------|--------|------|----------|
| 1 | `pnpm typecheck` | **PASS** | 0 | All 16 projects "Done"; no diagnostics |
| 2 | `pnpm lint` (`biome check .`) | **FAIL** | 1 | 2 errors, both in `packages/npm-client/src/installer.ts:508,511` |
| 3 | `pnpm check:deps` (`madge --circular`) | **PASS** | 0 | "No circular dependency found!" (295 files) |
| 4 | `pnpm test:run` (`vitest run`) | **PASS** | 0 | 113 files passed / 6 skipped; **849 tests passed, 16 skipped, 0 failed** |

**Overall verdict (verbatim): `pre-existing-only`.** The opencode-facade-m12
session's own changes are clean across typecheck, check:deps, and the full unit/
conformance/integration test suite. The single failing command (`pnpm lint`) fails
solely on two `lint/style/useTemplate` + `noUnusedTemplateLiteral` violations in
`packages/npm-client/src/installer.ts` — a file NOT in `git diff ec1a85a..HEAD`, last
edited by commit `bc6735e` ("ENATIVEUNSUPPORTED install policy") which **predates**
the session base. `pnpm lint` runs Biome tree-wide so this pre-existing defect blocks
the lint gate until fixed, but it is **not introduced by this session**.

> New-vs-pre-existing: every failing line is pre-existing and unrelated. No
> session-introduced check is red. The two lint errors should be cleared in a
> separate one-line commit (out of scope here per one-change-per-PR).

> Note: this verification log captures HEAD `19dbeac`; the ADR/doc/status commit
> that closes this session (ADR-0054/0055 files + README status + this log) is
> docs-only and changes none of the four checks above.

---

## (f) NEXT STEPS (for a human / next session)

**Unblock the vendored-tree work (the headline blocker):**

1. **Vendor opencode (feature 01).** Pin a SHA of anomalyco/opencode, generate the
   facade manifest (`catalog:`→concrete, drop `workspace:`, prune to KEEP-set),
   snapshot `node_modules`, add the shared `bootOpencodeFacade` helper. This is the
   single dependency that unblocks Spike C and features 03/04/06/07-T1/08.
2. **Run Spike C** against the REAL `createRoutes` graph with the tier-A throw-stub
   alone. Assert the ~40 layers BUILD with NO `Database` constructed at module eval.
   This decides whether the WASM-SQLite dep is a P4 need (deferred) or a
   pulled-forward P2 prerequisite (re-cut the milestone).

**Finish the no-vendored-tree slice that was assigned but not reached:**

3. **Land F02-T3..T7** (esm strip step + directed throw, CJS-require loud-throw,
   transform cache, parity `ts-esm` kind, and the **gold multi-file `.ts` parity
   case T7**). ADR-0052 explicitly requires T7 before P0 can be declared closed — it
   is NOT yet landed.
4. **Land F09-T1..T5** (read-substitute parity, pure-JS `vfsGrep` + failure-mode
   contracts, spawn-ceiling conformance test asserting `git`/`bash` → ENOENT-127,
   the FEASIBLE-vs-IMPOSSIBLE compat doc). All net/runtime-js/docs-only, no blocker.

**Fix the review findings before relying on `.ts` resolution at scale:**

5. **Exclude `*.d.ts`/`.d.cts`/`.d.mts`** from `DEFAULT_EXTENSIONS`/`INDEX_FILES`
   candidate matching (correctness-MAJOR) + add a conformance case (subpath with only
   `foo.d.ts`; directory with only `index.d.ts`) + update ADR-0053's deviation note.
6. **Bookkeeping faithfulness:** fix the dangling `loader.ts:21` "ADR-0052 D5"
   comment (→ `Q-2026-05-30-106`); relabel `decisions.md:53` ADR-0053 "(draft)" →
   ratified; document or add `unregisterBuiltin` to fix the parity-runner builtin
   leak; reconcile/drop the dead `.jsx` claim.
7. **Clear the pre-existing lint debt** (`installer.ts:508,511`) in a separate commit
   so the lint gate goes green.

**Ratify-when-gated (do NOT ratify speculatively):**

8. **ADR-0055/0056 (WASM-SQLite + drizzle)** — only after Spike C confirms the engine
   is genuinely needed, the `@sqlite.org/sqlite-wasm`-vs-sql.js evaluation + COI/SAB
   analysis are written, and the persistence scope (Q-2026-05-30-114) is decided.
9. **ADR-0058 (builtin surface)** — only when a real boot surfaces a CONCRETE named
   missing builtin (NOT `os.hostname`, which already exists).
10. **ADR-0061 (node:https→fetch)** — clear the C1 ai-Agent pre-flight first; run the
    live flow with `node:https` left as loud-throw and adopt the split only if it
    actually trips.
11. **ADR-0060 (v3 frame bump)** — only when the Worker becomes the opencode owner,
    via a superseding ADR that cites ADR-0048 D2 + amends ADR-0017.
