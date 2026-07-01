---
area: distribution
status: draft
title: eddy CDN tier — GET /bundle/<closureHash> so a shared/edge cache actually holds bundles
created: 2026-07-01
why: hosting-eddy.md advertised an "immutable CDN tier", but Cache-Control:immutable sits on the POST resolve response — shared caches never store POST, and there is no GET-by-hash route — so today only the in-process LRU is the immutable tier; the shared/edge tier is unbuilt
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/public/hosting-eddy.md, services/eddy/src/server.ts, services/eddy/src/cache.ts]
---

## Context

ADR-0182 §6 describes a two-tier cache: mutable `dep-set → closureHash` + immutable `closureHash → bundle` "held by a CDN via `Cache-Control: immutable`". Reality: the `immutable` header sits on the **POST /** resolve response (`server.ts`), which shared caches never store, and there is no `GET /bundle/<closureHash>`. So the immutable tier is ONLY the in-process `EddyCache` LRU (`cache.ts`) — bounded, per-process, lost on restart, not shared across instances or an edge.

This is a ceiling only at scale (multi-instance / post-restart / CDN-fronted). The current single-instance deploy is covered by the LRU, and the ~6x cold-install headline comes from the bundle mechanism (one round-trip + pre-seeded tarballs), not this cache. The shipped doc + `server.ts` comment were softened to say "in-process LRU now; a real CDN tier needs GET-by-hash" — this item is the real build.

## Options / Next

- Add a cacheable `GET /bundle/<closureHash>` returning the stored bundle bytes with the long-lived `immutable` cache-control (belongs on GET, not POST). A CDN in front of eddy then holds it forever (content-addressed, safe).
- Resolve the chicken-egg: the client learns `closureHash` only from a POST response. Either (a) POST computes + links + returns the closureHash and a small body, client then GET-by-hash (cacheable, big); or (b) POST 302 → GET-by-hash. Needs a design pass (likely an ADR: which flow, and the POST body shape).
- Gate on a CDN actually fronting eddy.rifty.dev (none today) — otherwise the GET route is correct but unexercised at the edge.

REVERSIBLE server capability, but the flow choice is a genuine design fork → refine to `ready` (rifty-refine) + likely a superseding-detail ADR before building.
