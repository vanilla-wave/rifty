---
area: npm-client
status: draft
title: Bundled popular-subgraph metadata blob
created: 2026-06-28
why: a static CDN metadata blob can pre-warm the packument cache for popular toolchain subgraphs, taking common metadata off the critical path with zero server compute
user_story: As a developer installing a popular stack (vite / express / eslint), I want its common dependency metadata to arrive in one fetch, but today each of ~70-85 packuments is an independent request.
epic: cold-npm-install-speedup
blocked_by: [perf/cold-install-metadata-reprofile]
sources: [https://developer.stackblitz.com/platform/webcontainers/turbo-package-manager, https://github.com/codesandbox/sandpack-cdn]
code: [packages/npm-client/src/installer.ts]
---

## Context

One gzip artifact on the CDN carrying abbreviated multi-version metadata for top-N packages / canonical closures. The client fetches it once and seeds `InstallOptions.packumentCache` (already public) — `createRegistrySource.loadPackument` checks `packumentCache.get` before the network. `walkAndPin` is unchanged, so determinism holds: the serial walk just reads cache. A miss / absent version falls through to a live fetch (honest, no stub). The blob MUST carry `os` / `cpu` per version-manifest or the ADR-0051 native gate is silently bypassed on the blob path.

## Open forks (resolve to reach ready)

- Full vs abbreviated multi-version blob (drift-resilience vs size); freshness via a generation timestamp + integrity, live fallback on any miss.
- Hit-rate: measure real pinned-closure overlap with a precomputed "popular" version set BEFORE building the generator — patch releases drift the set.
- Why medium, not high: against the post-ADR-0175/0176 baseline the CDN already edge-caches packuments, so the marginal win is collapsing many small edge-GETs into one fetch (real on high-RTT links, far from cold-npm headline numbers). Pursue only if the re-profile favors it over the resolver. Do NOT ship a resolved-closure blob standalone — that duplicates the lockfile fast path (ADR-0023).
- Needs: a build-time closure generator (tooling) + a CDN artifact via env-config (D-004).
