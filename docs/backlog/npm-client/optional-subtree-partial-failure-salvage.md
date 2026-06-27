---
area: npm-client
status: draft
title: Optional-subtree partial failure — salvage surviving required siblings vs npm atomic-rollback
created: 2026-06-08
why: rifty salvages surviving required siblings of a failed optional descendant; real npm rolls the whole optional subtree back atomically — an unpinned Node-parity divergence
user_story: As a developer running `npm install` where an optional dep's required grandchild fails, I want the same atomic optional-subtree rollback npm gives, but currently rifty keeps surviving siblings so my installed tree diverges from real npm
sources: [Q-2026-06-07-324, perf/npm-bounded-concurrency-tarball-fetch]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/installer-concurrency.test.ts]
---

## Context

`installer.ts` `walkAndPin`: an optional boundary that fetches OK but whose REQUIRED grandchild fetch fails warns-and-skips only the failed grandchild (`Promise.allSettled`), keeping main + opt + survivors. npm treats an optional dep's subtree ATOMICALLY (whole subtree rolls back). Pinned by a CHARACTERIZATION test (`installer-concurrency.test.ts`) so the divergence can't flip silently. Residual: an optional-boundary REJECTION rolls back its `scheduled`/`flatByName` claims (npm parity) but not the shared `inFlight` promise.

## Options or Next

Flip to atomic-rollback = own IRREVERSIBLE/ADR call (subtree tracking + unwind partial pins/on-disk writes + warn-message contract), NOT a revert. Keep salvage until a verified need.

## Reversibility

REVERSIBLE — provisional behavior, characterization-pinned. Atomic-rollback is the ADR path if taken up.
