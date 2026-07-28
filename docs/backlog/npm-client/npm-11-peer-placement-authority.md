---
area: npm-client
status: draft
title: npm 11 peer placement authority — traversal, conflicts, and replay
created: 2026-07-28
why: the recipe-v2 Contract+RED exposed that verified peer metadata still feeds only a warning pass, so missing peers, conflicting peers, their ordinary dependencies, and offline replay diverge from npm 11
user_story: As a browser-IDE user installing a package with peer dependencies, I want the same dependency tree or loud conflict that npm 11 produces, but today rifty can report success with an incomplete or incompatible tree
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-recipe-v2-authority]
sources: [ADR-0328, docs/backlog/npm-client/reference/npm-11-peer-placement-probe.md]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/linker.ts
  - packages/npm-client/src/installer-lockfile-reader.ts
---

## Context

The second consecutive Contract+RED blocker on the recipe-v2 execution unit
showed that npm peer traversal, placement, conflict resolution, lock facts, and
replay are a separate behavioral authority from shadow acquisition projection
and materialized bins. The predecessor still verifies the exact peer map before
tarball work. This required goal child owns consuming that verified map through
the ordinary installer path; it is draft and deliberately unmapped from the
epic Items/Budget until its own pre-pickup readiness window.

Today the installer persists `peerDependencies` only for a post-install
missing-peer warning. It neither resolves a missing peer and its dependency
closure nor distinguishes a direct conflict from a satisfiable nested peer
environment. That success claim is observably unlike npm 11 and cannot become
a shadow-only exception.

## Reference contract

Node v24.16.0 / npm 11.17.0 runs the committed self-contained loopback-registry
probe at source SHA-256
`5b6724ec792c2dff0d60740443b6fa843f94705f6392cad9df58e187c8f942fe`.
Its complete normalized output SHA-256 is
`edefe928491431545846ad63c3517863da1305d8acb7d3479df9c9d4ecb538c1`.
The artifact retains registry requests, exit/signal/stdout/stderr, every
materialized package manifest, and both npm lockfiles for direct and nested
missing/conflicting-peer branches. Successful branches remove `node_modules`
and reproduce the complete tree and locks under `npm --offline` with zero
registry requests.

## Acceptance

- One npm-client traversal/placement owner consumes peer maps for ordinary
  registry packages and registry-backed shadow acquisitions. No package name,
  shadow recipe, injected catalog, or second peer resolver selects behavior.
- A missing `contract-peer@^2.0.0` resolves `contract-peer@2.0.0` and recursively
  resolves its ordinary `contract-leaf@1.0.0` dependency. Direct and
  nested-without-conflict graphs hoist source, peer, and leaf to the root
  exactly as the committed npm tree does.
- A direct root `contract-peer@1.0.0` conflict rejects with `ERESOLVE` and the
  source/peer identities before any `node_modules` or lockfile mutation. It
  never degrades to a warning plus successful install.
- With the same root peer conflict below `contract-host`, source and peer 2 are
  placed under the host, root peer 1 remains visible, and the peer's ordinary
  leaf is hoisted to root. Lock entries retain source `peerDependencies` and
  mark both the installed peer and its peer-introduced dependency closure with
  `peer: true`, matching the committed npm facts.
- Every successful fresh case replays to the exact same rifty tree, placement,
  peer markers, dependency maps, resolution/integrity, and lock bytes with zero
  registry reads. Drifted or incomplete peer evidence loud-fails before reuse;
  replay never silently re-resolves a different peer environment.
- The four committed graphs run through the real public install core and
  registry/tarball/VFS boundaries. A fake resolver, post-install presence
  assertion, warning assertion, or shadow-only test cannot close Acceptance.
- Existing exact shadow projection, bundled dependency handling, materialized
  bins, v2 trace identity, and ordinary no-peer installs remain green.

## Parity cases

1. Direct missing peer: source, peer 2, and the peer's ordinary leaf install at
   root; peer and leaf lock entries carry `peer: true`.
2. Nested missing peer: host, source, peer 2, and leaf install at root with the
   same peer lock facts.
3. Direct conflicting root peer 1: npm and rifty fail `ERESOLVE` with no
   `node_modules` or lockfile.
4. Nested conflicting root peer 1: peer 1 remains at root; source and peer 2
   install under host; leaf remains at root; only the peer-introduced subtree
   carries peer lock facts.
5. Delete `node_modules` after each successful case and disable acquisition
   network: the same complete tree and lock replay with zero registry reads.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input / provenance-lie | malformed or drifted peer metadata never enters placement or a trusted replay | registry decode/projection mutations plus lock mutation table |
| observable-order | direct incompatibility reports `ERESOLVE` after required metadata reads but before tree/lock writes; nested compatibility proceeds | direct/nested conflict write ledger against the npm probe |
| unbounded-read / torn-state | stalled, partial, corrupt, aborted, or failed peer/leaf acquisition publishes no lock or success; retry reaches the exact tree | peer and recursive-leaf acquisition faults plus retry |
| quota-perm-fail / torn-state | rejection while writing a root or nested peer subtree stays loud and publishes no lock/success; retry reconciles exact bytes | root/nested VFS write faults |
| poisoned-cache / provenance-lie | matching lock replays exact placement and peer facts with zero reads; drift never selects cached but incompatible bytes | fresh→offline replay and lock mutation suite |
| sibling-drift | ordinary packages and registry-backed substitutions use the same peer traversal, placement, lock, and replay owner | shared four-graph contract through both acquisition entrances |
| frozen-assumption / lossy-aggregate | full normalized trees, lockfiles, errors, and request ledgers are compared; no boolean presence projection substitutes for the npm oracle | committed npm output differential |

## Out of scope

- Recipe schema/admission, acquisition projection verification, bundled
  extraction, materialized bins, v2 trace migration, and Workbench FIFO; the
  predecessor owns them.
- `peerDependenciesMeta.optional`, `--legacy-peer-deps`, `--force`, workspaces,
  linked peers, cyclic peer graphs, and npm's general multi-peer backtracking.
  They loud-throw `NotImplementedError('npm.peer-optional')`,
  `NotImplementedError('npm.peer-legacy')`,
  `NotImplementedError('npm.peer-workspace')`,
  `NotImplementedError('npm.peer-cycle')`, or
  `NotImplementedError('npm.peer-backtracking')` as applicable and remain
  compat ❌; no branch warns and claims a faithful tree.
- Byte-identical npm human diagnostic prose, npm debug/report files, lifecycle
  scripts, audit, or funding output. Stable `ERESOLVE`, involved package/range
  identity, mutation order, tree, and lock semantics are required.
- A new lock, FIFO, peer cache, public resolver SPI, or shadow-specific
  placement mechanism.

## Decisions

- The ordinary installer traversal owns peer execution for both normal and
  shadow-acquired packages; the recipe-v2 predecessor owns only exact peer-map
  verification.
- The npm 11 graph is the placement authority: direct incompatibility rejects,
  while a nested satisfiable peer environment nests source+peer and preserves
  the conflicting root peer.
- `peer: true` propagates across the dependency closure introduced solely by a
  peer, matching both committed npm lockfiles. Replay preserves that provenance
  instead of recomputing it from package presence.
- No coordination mechanism is added. Existing registry bounds, installer
  write/lock ordering, and Workbench physical serialization remain the owners.
- `split-predecessor: d5ffb3d2de8a27b26a13f541d2e5d16260d4b8d8` —
  second consecutive Contract+RED blocker forced this unit split; checkpoint
  lineage is preserved rather than restarted.
