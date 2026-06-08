---
area: perf
subsystem: runtime-js
status: active
title: ADR-0086 — carry ResolvedModule to execution (loadResolved) — drop second resolve+read+scope-walk
created: 2026-06-08
why: every module resolved twice + read+scope-walked twice per load; resolve() drops .source/.packageRoot then loadAsync re-resolves; write-before-code
sources: [perf-audit #14, adr-plan A/ADR-0086, ADR-0052 (downgraded — public ModuleLoaderOptions, not internal EsmLoaderDeps)]
---
## Context
loader.ts:184-187 → 139 → 159-160; esm.ts:113-117. resolve() runs full readResolved then passes only .id; loadAsync re-resolves. Governs internal EsmLoaderDeps/CjsLoaderDeps contract (loader.ts + esm.ts + cjs.ts); public ModuleLoader signatures unchanged. rule4 (symmetric impl ~3 files / >100 LOC; internal deps types not public → rule1 does not fire).
## Options / Next
Add `loadResolved(resolved)` entrypoint carrying already-resolved module; in executeEsm static-import preload call `loadResolved(dep)`. Acceptance = registry/cycle guards still fire and `esm:true` vs `esm:false` re-resolve stays equivalent for an absolute id. (Per-edge deps.resolve(spec) re-resolve in-degree D times NOT addressed here.)
## Reversibility
IRREVERSIBLE — rule4 (~3 files / >100 LOC). Not governed by ADR-0052 (that's public ModuleLoaderOptions; EsmLoaderDeps is internal). No decision subagent.
