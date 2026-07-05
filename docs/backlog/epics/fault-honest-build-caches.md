---
kind: epic
status: draft
title: Fault-honest build caches — esbuild module + transform cache never serve wrong bytes
created: 2026-07-05
value: Rebuild/reload always reflects current source — a stale, corrupt, or racing build-cache entry degrades to recompute/self-heal, never silently serves wrong output.
user_story: As a developer iterating in the playground, I want the esbuild module cache (and the planned persistent transform cache) to only ever accelerate, but today neither has fault tests on the poisoned-cache / concurrent-same-key axes — and the persistent cache is about to be built without a byte-stability contract.
items: []
---

## Outcome

PR #107 found poisoned-cache / concurrent-same-key / provenance-lie live in eddy's caches over 19 review rounds; the build-cache layer was built (module cache, PR #108) and is being designed (persistent transform cache) without fault rows for the same axes (`docs/process/fault-classes.md`). A build cache that can serve wrong bytes breaks Node-fidelity worse than any slow path.

## Candidate boundaries (items carved at refine)

- esbuild Module cache (boot-speedup PR #108): invalidation proof, corrupt-entry self-heal
- planned persistent transform cache: byte-stability + invalidation contract BEFORE it's built (cheapest moment)

## Items

(to be carved by `rifty-refine`; each child = its boundary's `## Fault matrix` rows + fixes)
