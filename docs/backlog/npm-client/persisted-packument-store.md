---
area: npm-client
status: draft
title: Persisted packument store (cross-session/cross-project)
created: 2026-06-28
why: packument metadata is re-fetched from scratch every session and every project; a persisted store would serve the "new project, same deps, no lockfile" case from local reads
user_story: As a developer opening a second project that shares deps with the first (no shared lockfile), I want its metadata served locally, but today the in-memory packumentCache dies with the page and nothing persists across projects.
epic: cold-npm-install-speedup
sources: [https://bun.com/blog/behind-the-scenes-of-bun-install]
code: [packages/npm-client/src/tarball-cache.ts, packages/npm-client/src/installer.ts]
---

## Context

`packumentCache` is an in-memory `Map` per install (`installer.ts createRegistrySource`), gone on reload; the only persisted install artifact is the per-project `VfsTarballCache`. A cross-session/cross-project packument store (mirroring `tarball-cache.ts`), consumed in `loadPackument` before the network with a freshness discipline matching the CDN policy (`max-age=300` + `stale-while-revalidate`, ADR-0176), would serve warm metadata locally. This is distinct from — and does NOT include — ETag/`If-None-Match` 304 revalidation (rejected: npmjs ignores conditional GET, and it saves bytes not RTT).

## Open forks (resolve to reach ready)

- Storage backend: VFS vs IndexedDB (npm-client has no IndexedDB backend today) vs the browser Cache API.
- Freshness + eviction policy; staleness bound; size cap.
- Low impact: most cold installs are first-ever for a given dep, so this only helps the repeat-distinct-project case — pursue after the re-profile confirms metadata transfer (not RTT depth) still costs on warm-ish runs.
