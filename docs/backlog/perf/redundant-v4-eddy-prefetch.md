---
area: perf
status: draft
title: Avoid redundant warm Eddy prefetch when v4 trust needs async hashing
created: 2026-07-17
why: v4's synchronous boot hint cannot hash exact lockfile bytes with WebCrypto, so it conservatively misses and may start a bounded Eddy prefetch that the later async trust check proves unnecessary
user_story: As a returning Workbench user with a trusted dependency tree, I want boot to avoid downloading a speculative dependency bundle that the project will not consume
blocked_by: [distribution/workbench-runtime-asset-cutover]
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md, docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md]
code: [apps/playground/src/glue/install-prefetch.ts, apps/playground/src/glue/install-stamp-authority.ts, packages/npm-client/src/eddy-prefetch.ts]
---

## Context

`InstallStampAuthority.checkSync()` must return `absent` for an on-disk v4
claim: exact `lockfileSha256` trust requires the ordinary async WebCrypto check.
Boot may therefore start the existing bounded Eddy prefetch before async
`check()` proves the tree reusable. Correctness is unchanged and the result
cannot mint trust, but response bytes and resolver work may be discarded.

This is an optional performance optimization, not a blocker or correctness
debt. Do not add/export a synchronous SHA implementation, weaken v4 identity,
delay the ordinary async trust gate, or make speculative prefetch authoritative.

## Path to ready

- Measure frequency, response bytes, and wall time of unused warm prefetches on
  the final Workbench composition; zero/unmeasurable waste closes the item.
- Compare cancellation after async trust, delaying prefetch until the async
  result, and a durability-qualified owner hint that still cannot mint trust.
- Choose one mechanism only if its saved work exceeds added boot latency and
  state complexity; record any new durable hint or public behavior in an ADR.
- When v4 implementation creates the call site, add
  `TODO(backlog: perf/redundant-v4-eddy-prefetch)` beside the accepted
  speculative branch.

## Out of scope

- Synchronous hashing, trusting a prefetch result, or changing the v4 claim.
- Removing ADR-0201 byte/no-progress bounds.
- Blocking install, Workbench open, cold STD measurement, or Eddy delivery.
