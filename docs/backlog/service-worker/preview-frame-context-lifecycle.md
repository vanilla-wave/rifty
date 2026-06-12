---
area: service-worker
status: active
title: Preview-frame context lifecycle beyond fixed-cap eviction
created: 2026-06-12
why: ADR-0097 needs SW-local iframe port context, but browser clients expose no direct unload signal for every iframe reload
sources: [ADR-0097, PR-15-review]
code: [packages/service-worker/src/preview-bridge.ts]
---
## Context

The SW stores preview-frame clientId -> port context so root-relative iframe
requests route to the preview owner. Current cleanup is bounded insertion-order
eviction, not precise lifetime tracking.

## Options or Next

Map browser support for detecting departed iframe clients, then replace or
tighten the cap with explicit deletion/revalidation.

## Reversibility

Reversible — lifecycle policy only, tracked by code TODO.
