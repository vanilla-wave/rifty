---
area: perf
subsystem: runtime-js
status: active
title: transformEsm result cache + optional transformEsm hook on EsmLoaderDeps
created: 2026-06-08
why: transformEsm (acorn parse + AST walk) — heaviest per-module CPU step — never cached; editor-save invalidate() loop re-parses every byte-identical module
user_story: As a dev iterating in the playground, I want save-and-rerun to skip reparsing modules I never touched, but today `transformEsm` (acorn parse + AST walk) is uncached so every `invalidate()` re-parses every byte-identical module — laggy edit loop.
sources: [perf-audit #16, adr-plan D, ADR-0052 (not governing — internal EsmLoaderDeps)]
---
## Context
esm.ts:102, esm-ast.ts:556-624. transformEsm never cached; editor-save invalidate() re-parses unchanged modules. Attaches to the existing loader-cache family; reuses existing cachedTransform / wrap-and-inject seam (loader.ts:90-99). NOT governed by ADR-0052 (that's public ModuleLoaderOptions; EsmLoaderDeps is internal). transformEsm verified pure.
## Options / Next
Add a `transformEsm?` hook field to internal EsmLoaderDeps (imported directly, not injected like the strip cache); executeEsm calls deps.transformEsm. id-keyed `Map<string,TransformResult>` dropped in lockstep with transformCache/registry (single-id-vs-full-clear must mirror transformCache). 2 files (esm.ts deps field + loader.ts wrap/invalidate). Record only the single-id-vs-full-clear coupling + transformEsm purity assumption as a TODO(backlog: perf/transformesm-cache) marker keyed to the loader-cache family.
## Reversibility
REVERSIBLE — rule5 → TODO(backlog: perf/transformesm-cache) keyed to the existing loader-cache family (no new Q, no new ADR). Internal EsmLoaderDeps, not public ModuleLoaderOptions. No decision subagent.
