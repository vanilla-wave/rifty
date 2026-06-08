---
area: npm-client
status: active
title: Two pre-existing biome lint errors in installer.ts:508,511
created: 2026-06-08
why: whole-tree `biome check .` has 2 pre-existing errors at installer.ts:508,511, tracked separately from the M12 slice
sources: [TASKS verification-snapshot, DoD summary]
---
## Context
`biome check` is clean on changed files, but whole-tree `biome check .` reports 2 pre-existing errors in `packages/npm-client/src/installer.ts:508` and `:511`. They predate the M12 no-vendored-tree slice (F02/F05/F09) and were carried as "tracked separately". CI lint passes per-PR on changed files, so these never gate but keep the whole-tree check red.
## Options / Next
Inspect installer.ts:508,511, fix the two biome violations (no test/behaviour change expected — lint only), verify `biome check .` clean whole-tree.
## Reversibility
Reversible — lint-only fix in one file, no public API / behaviour change.
