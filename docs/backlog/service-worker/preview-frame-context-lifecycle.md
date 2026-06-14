---
area: service-worker
status: active
title: Preview-frame context lifecycle beyond fixed-cap eviction
created: 2026-06-12
why: ADR-0097 needs SW-local iframe port context, but browser clients expose no direct unload signal for every iframe reload
user_story: As a developer keeping a long-lived preview iframe open, I want its root-relative requests to keep routing through the unique-worker fast path, but today active reads (`.get`) don't refresh recency so 256+ navigations elsewhere evict my live entry (not LRU) and the referrer rebuild silently downgrades my copied top-level tab to `copiedTopLevel: false` window-fallback
sources: [ADR-0097, PR-15-review]
code: [packages/service-worker/src/preview-bridge.ts]
---
## Context

The SW stores preview-frame clientId -> port context so root-relative iframe
requests route to the preview owner. Current cleanup is bounded insertion-order
eviction, not precise lifetime tracking.

Known caps of the current policy: reads (`.get`) do not refresh recency, so a
long-lived active iframe is evictable after 256+ navigations elsewhere while
fresher dead-client entries survive (not LRU); referrer recovery after
eviction/SW restart rebuilds the context with `copiedTopLevel: false`, silently
downgrading a copied top-level tab from the unique-worker fast path to the
window-fallback path.

## Options or Next

Map browser support for detecting departed iframe clients, then replace or
tighten the cap with explicit deletion/revalidation.

## Reversibility

Reversible — lifecycle policy only, tracked by code TODO.
