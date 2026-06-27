---
area: perf
subsystem: runtime-js
status: draft
title: resolver-internal resolution cache (key, full-clear on invalidate, never cache not-found)
created: 2026-06-08
why: no resolution cache — react from 200 files = 200 node_modules walks + pkg-json parses; invalidation is the whole risk; the backlog item is this file
user_story: As a dev whose app pulls a big dep like `react`, I want repeat `require`/`import` of the same specifier to skip re-walking `node_modules` + reparsing `package.json`, but today `resolveSpecifierToFile` is unmemoized so every one of 200 files re-walks — slow rebuilds.
sources: [perf-audit #15, adr-plan C, ADR-0004 (not contradicted)]
---
## Context
resolver.ts: no memo. Reversible memo of resolveSpecifierToFile (CPU not I/O — VFS is Map-backed). Does NOT contradict ADR-0004 (binds algorithm, not caching). Invalidation is the whole risk.
## Options / Next
Decision: memoize `resolveSpecifierToFile` (NOT the resolve() boundary — readResolved must re-read source fresh) keyed `${esm}\0${fromFile}\0${specifier}` → file-id; full-clear on ANY invalidate; NEVER cache not-found (guest fs.writeFileSync / npm-install-then-require writes to shared VFS without firing invalidate → poisoned absence); never cache the PACKAGE_PATH_NOT_EXPORTED throw path. Loader owns the result Map (mirrors transformCache) so Resolver interface stays unchanged. Record here; TODO(backlog: perf/resolution-cache) marker at resolver.ts (resolveSpecifierToFile ~line 167).
## Reversibility
REVERSIBLE — rule5 → record here + TODO(backlog: perf/resolution-cache). Does not contradict ADR-0004 (algorithm, not caching). No decision subagent.
