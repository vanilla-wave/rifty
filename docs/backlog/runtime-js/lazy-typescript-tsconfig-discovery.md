---
area: runtime-js
status: ready
epic: no-coi-client-bundle
title: Load the TypeScript compiler only on the paths that need it — never in the boot graph of a JavaScript-only runtime worker
created: 2026-06-26
why: three static TypeScript imports on the module-loader core path put the 3.5 MB compiler into every runtime worker bundle; the no-COI toolchain worker is 4.5 MB min / 1.3 MB gz, 77% of it TypeScript that plain-JavaScript hosts never execute.
user_story: As a headerless host embedding the no-COI toolchain sandbox to install and run Vite 7, I want the worker bundle to carry only what it runs, but today it downloads the whole TypeScript compiler for an eval error classifier and a default-off tsconfig option.
sources: [PR76 review C3, ADR-0170, ADR-0052, ADR-0066, docs/backlog/distribution/reference/no-coi-client-bundle-evidence.md]
code: [packages/runtime-js/src/module-loader/tsconfig-paths.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

ADR-0052 D2 keeps the loader free of compiler edges: `.ts` execution runs
through a host-injected `transformSource` hook. Three static `typescript`
imports broke that:

- `tsconfig-paths.ts` — opt-in `autoDiscoverTsconfigPaths` (ADR-0170), default
  off; `examples/vite-like-dev` opts in (the initial sweep missed examples/).
- `loader.ts` `requiresTypeScriptEvalContext` (:462) inside sync-typed
  `runNodeEvalScript` (:754), reached only from async `runNodeEntry`
  (`node-entry.ts`) — decides whether a `[eval]` source acorn rejects is
  TypeScript-only, to raise the named gap `runtime-js.node-eval-typescript-context`.
- `loader.ts` `nodeEvalConstBindingMarker` (:311) inside sync
  `projectNodeEvalError` (also the `projectUnhandled` callback). Both entered
  in `5289f38ea` (2026-07-30).

Measured (evidence doc): no-COI toolchain worker 4506 KB min / 1304 KB gz, of
which `typescript/lib/typescript.js` 3489 KB; compiler external → 999 / 294 KB.
Generic runtime worker 4202 / 1213 KB → 702 / 205 KB. The no-COI worker
injects no `transformSource`, so the compiler never executes a `.ts` file
there.

Sizing against the whole: ≈ 1 MB gz per cold boot of either worker, 0 on a
warm HTTP cache; first-install sessions also move `esbuild.wasm` (3.76 MB gz)
and tarballs. The recurring cost — parse/eval of the 3.5 MB UMD on every
boot/restart — is unmeasured; a boot-latency delta is an Acceptance row at
pickup, not a premise.

## Options or Next

One item and one `TODO(backlog: runtime-js/lazy-typescript-tsconfig-discovery)`
marker own all three imports; removing one does not close it. Proof: metafile
assertion under `splitting: true` that the eager boot chunk of a
JavaScript-only worker has no `typescript` input, plus loader tests that
default-off discovery and JavaScript-only eval never load the compiler.

Node 24 strips TypeScript in `-e` (`runtime-js/node-cli-typescript-eval-context`);
whatever stripper lands there stays on the same lazy path, never in the boot
graph.

## Challenge

challenge: 2026-09-06 — 4 problems
- Byte saving is bundler-conditional, not universal: esbuild `bundle` without `splitting` inlines `import('typescript')` into the single output (verified in-repo: 3478 KB min, vs 0 KB boot chunk + separate `typescript-*.js` with `splitting: true`), and Vite's default `worker.format: 'iife'` inlines dynamic imports too — so the Decisions line "yields a separate chunk in every consumer bundler" is false, and the evidence doc's own measurement script (no `splitting`) would still report ≈4.5 MB after the change; the documented host path does split (`packages/rifty/README.md:31` prescribes `worker: { format: 'es' }`, packed fixture `build.mjs` uses `splitting: true`), so the doc must pin that precondition into the proof and the user story (otherwise only eval is deferred, no bytes are cut).
- Impact sized only against one artifact (77% of the worker), never against the scenario the user story names: first-run "install and run Vite 7" also fetches `esbuild.wasm` 3.76 MB gz per install and QuickJS 232 KB gz per boot (evidence doc) plus 78 packages of tarballs (bytes unrecorded), so the ≈1 MB gz saving is a minority of first-run transfer and zero on a warm HTTP cache; the cost that actually recurs on every boot/restart (I6 restart primitive) — parse/eval of the 3.5 MB UMD — has no measured boot-latency delta anywhere in the doc.
- Decisions misname the lazy boundary: the classifier sits on `runNodeEvalScript`, reached only from async `runNodeEntry` (`node-entry.ts:195-207`) through sync-typed `NodeEvalScriptRunner.run(): unknown`; `evalInRepl` (`repl/eval.ts`) never calls it, and the const marker lives in sync `projectNodeEvalError`, which is also reused as the `projectUnhandled` callback — "error-path only, same lazy boundary" hides that these sync signatures change; name the real boundary and the signatures.
- Preload-at-creation machinery for `autoDiscoverTsconfigPaths: true` serves an opt-in with no production caller (repo-wide only `tests/conformance/modules/resolver.test.ts` and one unit test; ADR-0170's "TypeScript sandbox preset" consumer is not wired) — REV-7: weigh overturning ADR-0170 to explicit `paths` (ADR-0066) and deleting the tsconfig TS edge outright instead of adding an async-boot readiness precondition to a sync public option nobody uses; not blocking because the eval-classifier site still needs the lazy boundary for the whole value.

## Decisions

- ready-verdict: 2026-09-07 — preload delta Contract+RED @ a26862b005b63e0d525ee193e33ac3439d1f5ec9; failed-preload and restored discovery carriers accepted.

- re-cut: 2026-09-07 — ADR-0382 supersedes ADR-0380 D1 after examples/ caller discovery; preserve discovery via async preload before sync opt-in, restore baseline assertions — trace: ADR-0382.

- re-cut: 2026-09-07 — ADR-0381 adds a generated browser-scoped real compiler after executed lazy-import host-detection failure; promises and semantic assertions unchanged — trace: none.

- ready-verdict: 2026-09-07 — Contract+RED @ 366aa412a8f3582f7f464158ad730ce35b60fde8; packed/browser/timing acceptance remains required before Final+GREEN.

- 2026-09-07 — pickup: ADR-0380; no production discovery caller; remove discovery, retain explicit paths and loud obsolete-option throw. Original pickup missed examples/; ADR-0382 corrects the removal. Internal runner accepts prepared compiler; `projectNodeEvalError` receives it.
- 2026-09-07 — RED/reference and packed/browser GREEN: `docs/backlog/runtime-js/reference/lazy-compiler-evidence.md`.

- 2026-09-06 — fork resolved via rifty-refine (sync-eval classifier): acorn
  parses first; the compiler is reached only on the acorn-fail path.
- 2026-09-06 — boundary (after challenge): the async owner is `runNodeEntry`;
  on acorn failure it `await import('typescript')` before invoking the
  sync-typed `NodeEvalScriptRunner.run`; `projectNodeEvalError` receives the
  ready compiler (or none) as input instead of importing it. The sync
  signatures that change are named in the pickup contract. Success-path
  timing and the named gap error are unchanged.
- 2026-09-06 — precondition (after challenge): bytes are cut only under a
  splitting bundler — the documented host path (`packages/rifty/README.md`
  `worker: { format: 'es' }`, packed fixture `splitting: true`); an inlining
  bundler defers only evaluation. Proof lane = packed fixture, eager boot
  chunk; the evidence script gains `splitting: true` for post-change runs.
- 2026-09-06 — tsconfig edge (after challenge): at pickup prefer deleting it —
  overturn ADR-0170 by superseding ADR, explicit `paths` (ADR-0066) stays —
  unless a production caller exists by then; fallback is preload at loader
  creation for `autoDiscoverTsconfigPaths: true`.
- 2026-09-06 — compiler chunk fetch failure on the lazy path → loud error
  naming the chunk, never a silent JavaScript-only classification.
- Reversibility: REVERSIBLE — internal loading strategy.

## User scenario

The accepted host scenario is `docs/backlog/epics/no-coi-client-bundle/goal.md`.
Run a JavaScript-only worker and CLI eval without loading the compiler; run
non-JavaScript eval through the existing reference classification/error path.

## Acceptance

- Neither worker's complete eager graph (entry, automatic bootstrap, static closure) contains TypeScript, including real packed tarballs under ESM splitting. → I1
- JavaScript CLI eval runs without awaiting/importing the compiler; existing completion/identity/lifecycle/error assertions remain unchanged. → I1
- Non-JavaScript eval lazily loads the real compiler and preserves current named gaps and SyntaxErrors, including explicit CommonJS const markers. → I1
- Explicit `paths` and default resolution need no compiler; discovery preserves ADR-0170 after `preloadTsconfigPaths()`, and unprepared opt-in throws `TSCONFIG_NOT_READY`. Existing example HTTP/alias/baseUrl behavior remains. → ADR-0382
- Record before/after packed bytes and cold-worker boot timing; latency has no invented pass threshold. → scenario

## Parity cases

- Existing `process/node-eval-context*` cases retain Node-vs-rifty output/identity/error/lifecycle assertions; no reference golden changes. → I1
- All existing alias/discovery resolver and vite-like-dev integration assertions remain; opt-in callers gain preload preparation only. → ADR-0382

## Fault matrix

| Boundary / axis | Operation | Required outcome and carrier |
|---|---|---|
| ESM chunk load / false-fallback | first non-JS eval with compiler chunk unavailable | Loud compiler-chunk error with original URL/path cause; actual missing bundle output in `tests/integration/client-compiler-loading.test.ts`, browser request fault at final acceptance. → I1 |

| ESM chunk load / false-fallback | failed `preloadTsconfigPaths` | Reject with chunk cause, publish no ready parser; default/explicit paths remain usable. → ADR-0382 |

## Out of scope

- TypeScript eval execution remains the loud `runtime-js.node-eval-typescript-context` gap (compat ❌); no new stripper.
- Generic/no-COI VM policy, install splitting and io packaging belong to their linked goal items.
