---
area: playground
status: active
title: NotImplementedError hit telemetry (dev console/statusbar counter of stubs real consumers touch)
created: 2026-06-12
why: cheap; stub-priority is currently guesswork — a hit counter from real playground sessions turns backlog prioritization into data
sources: [ADR-0130, fullstack-demo feedback 2026-06-12]
code: [packages/io/src/errors.ts, packages/vfs/src/errors.ts, apps/playground/src]
---
## Context
`NotImplementedError` carries a structured `feature` field (`module.method`) and is thrown across vfs/net/npm-client/shell/runtime-* per the no-silent-stubs rule. Nobody aggregates the hits: the express demo found stubs by crashing into them one at a time. Gotchas: TWO class definitions (`packages/io/src/errors.ts`, `packages/vfs/src/errors.ts`) — match by `error.name === 'NotImplementedError'`, not `instanceof`; throws happen in worker realms, so capture must sit at a boundary the page already sees (worker error/unhandledrejection surface, kernel stdio/console bridge), not in the throwing packages.

## Options / Next
Counter keyed by `feature`; surface in playground dev console + statusbar badge; optional dump-table command. Capture point fork: (a) boundary capture — parse `name`/`feature` at worker error + console bridge (no cross-package coupling, misses swallowed-and-handled throws); (b) constructor hook (counts everything incl. caught ones, but couples io/vfs to a telemetry sink — dispreferred, reverse-import smell). Provisional pick: (a). Output feeds backlog priority directly: sorted hit-count per feature. Dev-only, no network, no persistence beyond session (or localStorage at most).

## Reversibility
REVERSIBLE — dev-only instrumentation, no public API. Capture-point choice is the provisional call this item records.
