---
area: runtime-js
status: parked
title: Worker stack remap and playground error overlay
created: 2026-06-12
why: loader-local TypeScript stack remapping now covers guest module execution, but spawned Worker errors and a visual playground overlay need separate host/worker plumbing
sources: [docs/research/open-webcontainers-alternative-2026-06.md, ADR-0052]
code: [packages/runtime-js/src/builtins/worker_threads.ts, apps/playground/src]
---

## Context

The ESM loader now extracts inline transform sourcemaps and remaps stack reads while a guest module
executes in the current realm. Remaining DX work crosses realm/UI boundaries: Worker-originated
errors need map data or normalized stack frames returned to the host, and the playground needs a
designed overlay surface instead of terminal-only reporting.

## Options or Next

- Gate: a worker-thread fixture that throws from transformed `.ts` and reports the original line.
- Then: carry remapped stack data over the Worker error channel without exposing loader internals.
- Add a playground overlay only after the error payload contract is pinned.

## Reversibility

REVERSIBLE while unimplemented. Worker error payload shape or overlay API may need its own decision
record once exposed beyond the current app.
