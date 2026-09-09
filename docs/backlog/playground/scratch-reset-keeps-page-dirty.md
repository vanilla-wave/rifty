---
area: playground
status: draft
title: Page retains dirty Scratch after an authoritative clean snapshot
created: 2026-09-09
why: the page can keep UNSAVED and discard prompts after the owner resets Scratch to its starter
user_story: As a Playground developer, I want Reset to starter to clear Scratch's unsaved state, but the page retains its prior dirty flag when the owner publishes clean state for the same starter.
sources: [docs/adr/playground/0165-multi-project-management-with-durable-scratch.md, docs/backlog/playground/reference/scratch-reset-keeps-page-dirty-evidence.md]
code: [apps/playground/src/glue/page-store.ts, apps/playground/src/adapters/playground-app.tsx, packages/workbench/src/workers/playground-project-authority.ts]
---

## Context

The real `createPageStore` retains `dirty:true` after `hydrateIndex` receives
`dirty:false` for the same active Scratch starter. Executed store probe:
`reference/scratch-reset-keeps-page-dirty-evidence.md`. No browser Reset run yet.

Reachable candidate: edit Scratch → Reset to starter → owner publishes clean
Scratch. Catalog `reset` writes `dirty:false`; the active app subscribes to that
catalog, but `keepLocalDirty` overrides the publication. The active Reset handler
does not call the legacy page-store `confirmReset`. Resulting UNSAVED/prompt
behavior still needs end-to-end reproduction.

The wrap-up's broader "optimistic dirty writer" explanation is stale:
`markDirty` is called by the unused `createAppProjectStore` wrapper; the active
app creates `createPageStore` directly. This finding concerns reconciliation.

## Next

Owner: Playground page/catalog integration. Trigger: pickup of Scratch Reset
repair. Reproduce the full edit → Reset journey before changing behavior;
preserve protection against genuinely stale clean publications. No chosen
mechanism, new policy, or implementation authorization.

Dedup: no matching Reset/`keepLocalDirty` finding in backlog, goal maps, traps,
or declined concepts. `template-edit-provenance-reset` tracks per-file provenance;
its whole-workspace Reset portion is already superseded by ADR-0165.
