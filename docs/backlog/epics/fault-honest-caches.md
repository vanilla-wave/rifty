---
kind: epic
status: draft
title: Fault-honest caches — never wrong bytes under a stable key
created: 2026-07-05
value: Every cache layer can only ever accelerate — a stale, corrupt, or racing entry degrades to recompute/self-heal, never silently serves wrong output.
user_story: As a developer iterating in the playground, I want rebuild/reload to always reflect my current source, but today no cache layer besides eddy's (hardened by #107 review) has fault tests proving honest degradation on the poisoned-cache / concurrent-same-key / provenance-lie axes.
items: []
---

## Outcome

PR #107 found the poisoned-cache, concurrent-same-key and provenance-lie axes live in eddy's caches over 19 review rounds; the other cache layers were built without fault rows for the same axes (`docs/process/fault-classes.md`). Sweep every cache boundary with the fault matrix: prove self-heal / recompute / loud throw, fix what lies. Mission anchor: a cache that can serve wrong bytes breaks Node-fidelity worse than any slow path.

## Candidate boundaries (items carved at refine)

- esbuild Module cache (boot-speedup PR #108): invalidation proof, corrupt-entry self-heal
- planned persistent transform cache — byte-stability contract BEFORE it's built
- npm tarball cache + eddy client cache: #107 already added fault tests — tag into the fault tier, fill gaps
- learned pins (`/.rifty/eddy-learned-pins.json`): corrupt/oversized file, TTL/cap races

## Items

(to be carved by `rifty-refine`; each child = its boundary's `## Fault matrix` rows + fixes)
