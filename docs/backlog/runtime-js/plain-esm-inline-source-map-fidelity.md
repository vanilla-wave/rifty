---
area: runtime-js
status: draft
title: Plain ESM inline source maps preserve original diagnostics
created: 2026-07-19
why: the module loader extracts inline maps only from injected TS or JSX transform output, so generated plain .js and .mjs modules report temporary paths and lines instead of their original source
user_story: As a developer whose Node tool generates an ESM module with an inline source map, I want a thrown error to name my original config and line, but today Workbench diagnostics point at the generated module.
epic: workbench-stabilization
blocked_by: []
sources: [PR-153-post-merge-audit, ADR-0136, Node-v24-enable-source-maps, Vite-v8-config-loader]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/source-maps.ts]
---

## Context

`createModuleLoader()` extracts an inline source map only from the result of an optional `transformSource` hook. Plain `.js` and `.mjs` source bypasses that path; `executeEsm()` records only Rifty's generated-line rewrite map. Even when a map is extracted, `DecodedSourceMap` currently discards `sources` and `sourceRoot`, and stack rendering always keeps the generated module id. A generic generated ESM fixture with a valid inline v3 data URL therefore cannot report the original source identity as Node does with source maps enabled. Vite's bundle config loader is one real consumer, not the runtime contract or the production branch condition.

## Refinement path

- RED parity against Node v24 with generic `.mjs` fixtures: relative and absolute `sources`, `sourceRoot`, multiple source entries selected by segment, original path/line/column, thrown error, dynamic import, repeated import, and invalid-map behavior.
- Define source-identity resolution relative to the generated module plus composition and ownership between a source-provided map, an injected transform map, and Rifty's ESM rewrite line map. Invalidation must remove the complete map state for the exact module id.
- Preserve ADR-0136's scoped `prepareStackTrace` behavior while refining. Decide whether plain inline maps participate only in that top-level evaluation scope or follow Node's source-map enable state; any change to the observable remap window requires a follow-up ADR before this item becomes `ready`.
- Add a real Workbench acceptance proof using unmodified Vite config loading: a thrown user-config error names the original config and line and does not expose the generated temp path as the primary diagnostic.
- Keep all production parsing/remapping generic. `vite-knowledge-boundary` owns any explicit Vite integration; this item cannot close with a Vite filename check or cache-path special case.
- `runtime-js/process-module-loader-surface` owns public `module.SourceMap` and source-map enable APIs. `runtime-js/worker-stack-remap-error-overlay` owns worker, runtime-phase, and UI-overlay propagation. This item owns plain-ESM extraction, source identity, and composition inside the accepted scoped loader path.
