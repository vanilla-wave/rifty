---
area: process-meta
status: draft
title: Pickup excludes executable test and fixture sources
created: 2026-07-28
why: Contract+RED tests currently move pickup before their judge-authored ready authority, so contract-drift and budget reject the documented autonomous slice sequence
sources: [PR #209, docs/backlog/README.md, tools/checks/run-pickup.mjs, tools/checks/budget.mjs]
code: [tools/checks/run-pickup.mjs, tools/checks/run-pickup.test.ts]
---

## Context

`pickupCommit` calls every TypeScript path below `apps/`, `packages/`, or
`services/` production source. In PR #209, the exact Contract+RED commit adds
only `*.test.ts` files after a raw contract. The next commit records the clean
checkpoint and flips its item ready, as required by
`decision-workflow.md`. Pickup nevertheless becomes the parent of the RED
tests, so `check:contract-drift` rejects that ready authority and
`check:budget` cannot see the selected row.

`budget.mjs` already owns the repo's test/fixture path classification for
mechanism scanning. Pickup needs that same classification before its first
production-source decision. The adjacent
`process-meta/contract-drift-comment-relink-false-positive` item is not a
duplicate: it needs hunk-level comment classification; this item is the
strict path-level test/fixture case.
