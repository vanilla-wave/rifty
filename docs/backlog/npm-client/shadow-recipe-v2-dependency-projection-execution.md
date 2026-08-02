---
area: npm-client
status: draft
title: Shadow recipe v2 dependency projection execution
created: 2026-07-28
why: the narrowed recipe-v2 Contract+RED proved exact LightningCSS metadata and bundled extraction but its positive oracle cannot prove non-bundled traversal, optional omission, non-empty peer handoff, or accepted scoped keys
user_story: As a browser-IDE user installing a registry-backed substitution, I want every reviewed dependency map to drive the same ordinary installer behavior as its registry source, without silently acquiring an omitted dependency or dropping scoped and peer metadata
epic: honest-shadow-substitutions
sources: [ADR-0335]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/registry.ts
---

## Context

The predecessor's real LightningCSS positive oracle contains one required
dependency that is also bundled, plus empty optional and peer maps. Its
mutation table proves exact rejection, but cannot prove that accepted
non-bundled required, retained optional, omitted optional, non-empty peer, and
scoped entries drive the intended installer path. The binding second
Contract+RED checkpoint therefore preserves that behavior in this required
goal child instead of weakening it or accepting mutation-only coverage.

This item is draft and deliberately unmapped from the epic Items/Budget until
its own external golden, executable positive oracle, fault matrix, and
Contract+RED reach readiness. The predecessor remains required first.

## Reference contract

- Registry acquisition verifies the complete required, retained optional,
  omitted optional, peer, and bundled projection before tarball work. Only
  non-bundled required and retained-optional maps enter ordinary dependency
  resolution in this unit; the verified peer map remains exact metadata for
  `npm-client/npm-11-peer-placement-authority`. Scoped package names are valid
  in every projection map.
- A committed registry-backed positive oracle must exercise every accepted
  branch through real packument, tarball, cache, VFS, tree, and lock
  boundaries. Projection mutations remain rejection evidence and cannot
  substitute for a successful traversal/omission/handoff differential.

## Acceptance

- Matching non-bundled required dependencies enter the ordinary dependency
  resolver and materialize with exact name, range, version, integrity, tree,
  and lock facts.
- Matching retained optional dependencies enter that same resolver and retain
  ordinary optional-boundary behavior; matching omitted optional dependencies
  produce no registry/cache reads, install-tree entry, or lock entry.
- A matching non-empty peer map is handed off intact to the ordinary
  npm-client peer authority. This item neither warns, traverses, resolves,
  places, nor replays the peer tree; those behaviors remain owned by
  `npm-client/npm-11-peer-placement-authority`.
- Scoped package names are accepted and preserved in required, retained
  optional, omitted optional, peer, and bundled maps through projection
  verification and their owned downstream handoff.
- Projection drift in any complete map still rejects with the recipe's named
  unsupported feature before tarball, cache, VFS, tree, or lock mutation.
- The executable positive oracle uses the owner-decoded builtin catalog and
  real public install core. No injected/custom recipe SPI, fake resolver,
  package-name branch, or assertion over an isolated projection helper can
  close Acceptance.
- The predecessor's exact LightningCSS bundled extraction, materialized bins,
  v2 replay, Workbench FIFO, and Chromium acceptance remain green.

## Parity cases

1. A registry-backed recipe with matching non-bundled required and retained
   optional scoped dependencies acquires each complete ordinary dependency
   closure and records the exact tree and lock.
2. The same recipe's matching omitted optional scoped dependency causes zero
   packument, tarball, cache, VFS, tree, and lock work for that entry.
3. Its non-empty scoped peer map reaches the ordinary peer authority
   byte-for-byte; peer traversal and placement are proven by
   `npm-client/npm-11-peer-placement-authority`.
4. Required, retained optional, omitted optional, peer, and bundled scoped
   keys survive exact projection comparison without unscoping, aliasing, or
   lossy aggregation.
5. Drift each map independently: rejection precedes tarball and VFS work while
   every unmutated positive branch remains executable.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input / provenance-lie | malformed or drifted complete maps never enter acquisition or trusted replay | strict ingress plus independent map mutation table |
| observable-order | projection verifies before tarball; omitted optionals and peer handoff never enter ordinary dependency traversal in this unit | registry/cache/VFS ledgers per positive branch |
| sibling-drift | required and retained optional entries use the ordinary dependency resolver; peer metadata uses the ordinary peer handoff | shared public-install tree/lock differential |
| frozen-assumption / lossy-aggregate | scoped keys survive in every map and handoff; no name-only or boolean summary substitutes for exact maps | scoped positive oracle plus exact tree/lock/handoff assertions |
| unbounded-read / torn-state | stalled, aborted, corrupt, or failed accepted dependency acquisition publishes no success or lock; retry reaches exact bytes | required/retained-optional acquisition faults plus retry |
| poisoned-cache / provenance-lie | replay preserves exact projection outcome with zero registry reads; drifted projection evidence loud-fails | fresh-to-offline replay and lock mutation table |

## Out of scope

- Schema-2 codec/admission, exact current LightningCSS metadata verification,
  embedded bundle extraction/lock, materialized bins, v2 replay, Workbench
  FIFO, and Chromium acceptance; the predecessor owns them.
- Traversing, resolving, placing, conflicting, or replaying peer dependency
  trees; `npm-client/npm-11-peer-placement-authority` owns those behaviors.
- The Sass recipe or package-specific recognition.
- A public/custom recipe SPI, second resolver, second peer owner, cache, lock,
  FIFO, or coordination mechanism.

## Decisions

- Projection comparison remains generic clone-safe recipe data executed by the
  existing registry-backed install path. The child adds executable coverage,
  not another projection owner.
- Required and retained optional entries enter ordinary dependency traversal;
  omitted optionals do not. Non-empty peer maps transfer intact to the
  separately owned npm peer authority.
- Accepted scoped keys are a positive contract in every map; drift-only
  fixtures cannot prove them.
- `split-predecessor: b7725a3e88278f4f24efb1d8c8d90e80de08de43`
  — the second narrowed Contract+RED checkpoint forced this unit split;
  lineage is preserved rather than restarted.
