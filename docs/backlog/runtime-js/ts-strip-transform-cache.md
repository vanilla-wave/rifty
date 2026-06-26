---
area: runtime-js
status: shipped
title: Loader-internal TS-strip transform cache — key + invalidation
created: 2026-06-08
why: shipped — the id-keyed TS strip cache records the transformed source text and re-runs the transform when same-path source bytes change
user_story: As a developer live-editing a `.ts` file in place under an HMR layer, re-import picks up my edit because a same-path source change misses the recorded-source cache entry
sources: [ADR-0052 D4]
code: [packages/runtime-js/src/module-loader/loader.ts:81]
---
## Landed 2026-06-22
`loader.ts` still caches per resolved id, but each entry records the source text it transformed. A byte-identical reload hits the cache; a same-path source edit re-runs the TS strip even if only the executed-module registry entry was invalidated. Source maps and the ESM AST cache move in lockstep. Regression: `packages/runtime-js/src/module-loader/loader-transform.test.ts`.
## Reversibility
Reversible (<20 lines, 1 file) — internal to `createModuleLoader`, no new export, no signature change, no dep. Plain-JS loaders unaffected.
