---
area: npm-client
status: active
title: Failed root optionalDependency permanently defeats the lockfile fast path
created: 2026-06-12
why: lockfile-write drops failed optionals, but the next install's coverage check requires every top-level request (optionals included) to be pinned — one failed optional forces a full registry re-resolve on EVERY subsequent install
sources: [PR #21 review]
code: [packages/npm-client/src/installer.ts]
---

## Context

`chooseSource` merges `effectiveOptionalDependencies` into the coverage request; a root optional
that failed (native-unsupported, lifecycle-reject) is absent from the lockfile, so
`lockfileCovers` returns null forever — silent O(tree) registry work per install. npm's
semantics: optionals are retried per install but a lockfile still fast-paths the rest.

## Options or Next

- Coverage check on required deps only; optionals resolve via lockfile when pinned, else a
  per-install registry attempt (mixed-source walk — needs care with override divergence).
- Or record failed optionals in the lockfile (npm stores them with `optional: true`).

## Reversibility

REVERSIBLE — install-path heuristic; lockfile shape change would need more care.
