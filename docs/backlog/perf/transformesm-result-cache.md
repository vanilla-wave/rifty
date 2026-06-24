---
area: perf
subsystem: runtime-js
status: shipped
title: transformEsm result cache + optional transformEsm hook on EsmLoaderDeps
created: 2026-06-08
why: transformEsm (acorn parse + AST walk) — heaviest per-module CPU step — never cached; editor-save invalidate() loop re-parses every byte-identical module
user_story: As a dev iterating in the playground, I want save-and-rerun to skip reparsing modules I never touched, but today `transformEsm` (acorn parse + AST walk) is uncached so every `invalidate()` re-parses every byte-identical module — laggy edit loop.
sources: [perf-audit #16, adr-plan D, ADR-0052 (not governing — internal EsmLoaderDeps)]
---
## Landed 2026-06-22
`loader.ts` injects a cached `transformEsm` wrapper through `EsmLoaderDeps`; cache entries are keyed under resolved id but validated against transformed source text, so byte-identical reloads skip parse/walk while an in-place edit at the same path re-parses. The cache is cleared with the module/strip/source-map caches on `loader.invalidate(id?)`. Regression: `packages/runtime-js/src/module-loader/loader-transform.test.ts`.
## Reversibility
REVERSIBLE — rule5 → TODO(backlog: perf/transformesm-cache) keyed to the existing loader-cache family (no new Q, no new ADR). Internal EsmLoaderDeps, not public ModuleLoaderOptions. No decision subagent.
