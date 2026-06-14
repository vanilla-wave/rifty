---
area: perf
subsystem: runtime-js
status: active
title: loader-internal package.json parse cache (key + invalidation)
created: 2026-06-08
why: readPackageJson has no cache — N modules from one package = N decode+parse of its package.json; invalidation-coherence is the risk; the backlog item is this file
user_story: As a dev importing N files from one package, I want its `package.json` parsed once, but today `readPackageJson` has no cache so each import re-decodes+`JSON.parse`s the same file — N times the parse cost
sources: [perf-audit #5, adr-plan C]
---
## Context
resolver.ts:594 readPackageJson, called at 293/356/425 + inlined JSON.parse at 624. No cache. Reversible Map cache across the 4 parse sites. Risk = invalidation coherence (stale type/exports/main): load-fixture reload overwrites files (incl. package.json) then calls invalidate(); an unwired cache serves stale.
## Options / Next
Decision: `Map<string,PackageJson>` on the loader closure routing all four parse sites; cleared in `loader.invalidate()` in lockstep with transformCache (full-clear on id===undefined, per-id delete otherwise). Wiring nuance: bridge loader-owned invalidate to resolver-owned parse sites (thread cache into createResolver or co-locate). Test: edit package.json → invalidate() → new value observed. Record here; TODO(backlog: perf/pkgjson-cache) marker at resolver.ts (readPackageJson ~line 594; sites 293/356/425/624).
## Reversibility
REVERSIBLE — rule5 → record here + TODO(backlog: perf/pkgjson-cache). No decision subagent. (Note: compute findPackageScope-once #4 is the byte-identical NONE companion in none-items-quick-wins.)
