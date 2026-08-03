---
area: npm-client
status: draft
title: Shadow recipe v2 dependency projection execution
created: 2026-07-28
why: the current builtin recipes have no honest positive carrier for retained-optional execution, non-empty peer handoff, or accepted scoped keys across every projection map
user_story: As a browser-IDE user installing a future registry-backed substitution with retained optionals, peers, or scoped projection entries, I want those reviewed maps to drive the ordinary installer authorities without losing names or silently changing acquisition
sources: [ADR-0335]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/registry.ts
---

## Context

The predecessor's real LightningCSS oracle contains one required dependency
that is bundled plus empty optional and peer maps. The official Sass 1.100.0
oracle supplies non-bundled required dependencies and one omitted optional, so
those reachable branches moved into `npm-client/sass-embedded-substitution`.
Neither current builtin recipe honestly carries a retained optional, non-empty
peer map, or positive scoped entry in every map. Mutation-only tests, an
injected recipe, or a third builtin added only for coverage cannot prove those
accepted branches.

This item therefore remains an ordinary draft outside the frozen
`honest-shadow-substitutions` goal. It preserves the unproven behavior until a
real supported substitution supplies the positive production carrier; it does
not block Sass or epic closure.

## Readiness blockers

- A real production builtin recipe, justified by a supported package rather
  than coverage, must carry the retained-optional and scoped projection
  branches it claims to prove through official registry artifacts.
- A non-empty peer projection needs an executable handoff proof at the ordinary
  peer authority. Traversal and placement remain independently owned by
  `npm-client/npm-11-peer-placement-authority`.

## Reference contract

- Registry acquisition verifies the complete required, retained optional,
  omitted optional, peer, and bundled projection before tarball work.
  Retained-optional maps enter ordinary dependency resolution; the verified
  peer map remains exact metadata for
  `npm-client/npm-11-peer-placement-authority`. Scoped package names are valid
  in every projection map.
- A committed registry-backed positive oracle must exercise every accepted
  branch through real packument, tarball, cache, VFS, tree, and lock
  boundaries. Projection mutations remain rejection evidence and cannot
  substitute for a successful traversal/omission/handoff differential.

## Acceptance

- Matching retained optional dependencies enter the ordinary dependency
  resolver and retain ordinary optional-boundary behavior, including loud
  acquisition failure semantics and exact tree/lock provenance.
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
- Existing LightningCSS bundled extraction and Sass non-bundled-required /
  omitted-optional execution, materialized bins, v2 replay, Workbench FIFO, and
  Chromium acceptance remain green.

## Parity cases

1. A registry-backed recipe with a matching retained optional scoped
   dependency acquires its complete ordinary dependency closure and records
   the exact optional boundary, tree, and lock.
2. Its non-empty scoped peer map reaches the ordinary peer authority
   byte-for-byte; peer traversal and placement are proven by
   `npm-client/npm-11-peer-placement-authority`.
3. Required, retained optional, omitted optional, peer, and bundled scoped
   keys survive exact projection comparison without unscoping, aliasing, or
   lossy aggregation.
4. Drift each map independently: rejection precedes tarball and VFS work while
   every unmutated positive branch remains executable.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input / provenance-lie | malformed or drifted complete maps never enter acquisition or trusted replay | strict ingress plus independent map mutation table |
| observable-order | projection verifies before tarball; peer handoff never enters ordinary dependency traversal in this unit | registry/cache/VFS ledgers per positive branch |
| sibling-drift | retained optional entries use the ordinary dependency resolver; peer metadata uses the ordinary peer handoff | shared public-install tree/lock differential |
| frozen-assumption / lossy-aggregate | scoped keys survive in every map and handoff; no name-only or boolean summary substitutes for exact maps | scoped positive oracle plus exact tree/lock/handoff assertions |
| unbounded-read / torn-state | stalled, aborted, corrupt, or failed retained-optional acquisition publishes no success or lock; retry reaches exact bytes | retained-optional acquisition faults plus retry |
| poisoned-cache / provenance-lie | replay preserves exact projection outcome with zero registry reads; drifted projection evidence loud-fails | fresh-to-offline replay and lock mutation table |

## Out of scope

- Schema-2 codec/admission, exact current LightningCSS metadata verification,
  embedded bundle extraction/lock, materialized bins, v2 replay, Workbench
  FIFO, and Chromium acceptance; ADR-0335 and the landed recipe-v2 split
  authorities own them.
- Sass non-bundled required traversal and omitted-optional suppression;
  `npm-client/sass-embedded-substitution` owns their real positive carrier.
- Traversing, resolving, placing, conflicting, or replaying peer dependency
  trees; `npm-client/npm-11-peer-placement-authority` owns those behaviors.
- The Sass recipe or package-specific recognition.
- A public/custom recipe SPI, second resolver, second peer owner, cache, lock,
  FIFO, or coordination mechanism.

## Decisions

- Projection comparison remains generic clone-safe recipe data executed by the
  existing registry-backed install path. The child adds executable coverage,
  not another projection owner.
- Retained optional entries enter ordinary dependency traversal. Non-empty
  peer maps transfer intact to the separately owned npm peer authority.
- Accepted scoped keys are a positive contract in every map; drift-only
  fixtures cannot prove them.
- `split-predecessor: b7725a3e88278f4f24efb1d8c8d90e80de08de43`
  — the second narrowed Contract+RED checkpoint forced this unit split;
  lineage is preserved rather than restarted.
- `goal-recut: 2026-08-02` — the catalog-carrier audit found no honest builtin
  for retained optionals, non-empty peers, or positive scoped entries across
  every map. Sass absorbed the required/omitted branches it actually carries;
  this residual stays explicit outside the frozen goal until a real package
  makes it reachable.
