---
area: npm-client
status: draft
title: Resolved-package installer path ingress
created: 2026-07-28
why: the terminal install-path RED proved the real installer is a separate raw package-path ingress that must consume the linker carrier instead of duplicating its validation
user_story: As a browser-IDE user installing a package, I want installer target preparation to reuse the exact linker-approved scope before project files or the lock change, but today it can trust the raw path separately
epic: honest-shadow-substitutions
blocked_by: [npm-client/resolved-package-installer-prepared-path-consumption]
sources: [ADR-0042, ADR-0261, docs/backlog/npm-client/reference/resolved-package-install-path-contract-red.md]
code:
  - packages/npm-client/src/installer.ts
---

## Context

This was the second serial split successor to terminal
`npm-client/resolved-package-install-path-authority` at
`42e53d1b2c94b89fab1650794b1cff3477e8f54e`. Its second Contract+RED
checkpoint proved that observable prepared-path consumption and unobservable
package-reference identity were incorrectly mixed in one contract. This item
is now a terminal blocked split predecessor and receives no third checkpoint.

`npm-client/resolved-package-installer-prepared-path-consumption` owns the
observable target/error/effect boundary and the one package-private prepared
carrier import. It adds no installer-local validator or carrier.

Package-bin claim/phased-linker work starts only after this ingress lands.
Tar-entry containment, resolver placement, and substitution planning retain
their existing authorities.

## Reference contract

- The real installer invokes linker preflight once after acquisition. Target
  preparation, package linking, and lock construction accept that exact
  carrier; raw `ResolvedPackage.installPath` has one authority in `linker.ts`.
- The carrier never crosses a public callback. Direct behavioral composition
  proves its three prepared consumers; Final source/type review proves the one
  local real-install binding without a mock, source-grep test, or test hook.
- Root and nested binful packages preserve package identity, relative path,
  owning `node_modules` directory, and exact absolute target.
- A malformed resolved path rejects as `EINVALIDPACKAGETAR` before project-tree
  or lock mutation.

## Acceptance

- Package-private `packageLinkTargets()` accepts prepared packages and derives
  exact absolute targets from them. It never accepts or rereads raw
  `installPath`.
- Real install calls `preflightPackageInstallPaths()` exactly once after
  acquisition, then passes the same prepared array to
  `packageLinkTargets()`, `linkPreparedInstallTree()`, and
  `buildPreparedInstallLockfile()`.
- Omitted, root, nested, and nested-scoped packages retain exact target order
  and identities. Valid root/nested binful poisoned getters are read once.
- Every malformed path physically reachable through the supported real
  installer entrance — traversal, dot segment, and double separator — rejects
  through linker preflight with its raw path. `assertPortablePaths` is not
  invoked; the full raw malformed matrix remains at the linker boundary.
- A real install mixing a valid package with an invalid traversal package
  rejects before any post-acquisition VFS operation, project tree, or lock
  publication. The existing valid installer suite remains byte-identical.
- No installer helper defines another raw-path grammar or prepared shape.

## Parity cases

1. Direct installer targets consume the linker carrier for omitted, root,
   nested, and nested-scoped packages in input order.
2. Valid root/nested binful poisoned packages are preflighted once, then yield
   exact targets from the same carrier without another raw read.
3. Real mixed installs with reachable traversal, dot-segment, and
   double-separator paths reject `EINVALIDPACKAGETAR` before target, project-tree,
   or lock effects; the inherited linker suite retains the full raw matrix.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | real installer preflight rejects every reachable malformed path with exact raw path; impossible raw shapes stay covered at linker ingress | mixed-install table plus inherited linker matrix |
| sibling-drift | one prepared array reaches targets, link, and lock; installer defines no parallel validator/shape | poisoned-read prepared composition plus Final source/type review of the real-install binding |
| observable-order | real install validates every resolved target before post-acquisition mutation | all-method VFS ledger |

## Out of scope

- Raw grammar or a second carrier; the predecessor owns both.
- Package-file/bin phases, bin claims/collisions, and launcher faults;
  `npm-client/package-bin-claim-linker-authority` owns them.
- Tar-entry containment, resolver placement, peer placement, replay, a public
  path API, new module, coordinator, scheduler, or lock.

## Decisions

- `terminal-checkpoint:
  30abc22f61d3b5753cb7c65bb6bd75d8e88064ea` — second Contract+RED BLOCKED;
  this unit receives no third checkpoint.
- `checkpoint-lineage: [b9bd5b4e977c48182c00bdb51d2c6331675641a9,
  30abc22f61d3b5753cb7c65bb6bd75d8e88064ea]`.
- `split-successors:
  [npm-client/resolved-package-installer-prepared-path-consumption]`.
- Contract+RED @ `30abc22f61d3b5753cb7c65bb6bd75d8e88064ea`
  blocked: the executable command still named the predecessor linker suite,
  and deep equality could not prove the claimed package-reference identity.
  The re-refined successor runs its own RED with both siblings and removes the
  non-observable identity claim instead of adding a mock, callback, or hook.
- The same verdict requested a Budget mapping and draft PR before PASS. The
  binding protocol requires the Budget declaration/mapping before review and
  pickup, but opens the unit PR only at first PASS; the successor retains that
  split timing.
- Contract+RED @ `b9bd5b4e977c48182c00bdb51d2c6331675641a9`
  blocked: the direct composition did not itself prove real-install reference
  identity, and the real malformed table omitted its inherited traversal floor.
  This re-cut makes the non-observable carrier proof boundary explicit and
  converges every physically reachable real-install row.
- `split-predecessor:
  42e53d1b2c94b89fab1650794b1cff3477e8f54e`; predecessor checkpoints:
  `8f375ce5c5149b3ce8ff6fb9696063482c098dc0` and
  `42e53d1b2c94b89fab1650794b1cff3477e8f54e`.
- This unit consumes the linker-owned carrier directly. A second installer
  validator, carrier, or per-phase preflight would preserve the terminal
  sibling-drift fault.
- The real install proof remains an integration sibling, not a new placement
  policy or resolver state.
- Package-private carrier reference identity has no honest public observation.
  Adding a mock, callback, or orchestration hook only to count it would violate
  the test and simplicity rules; direct prepared behavior plus Final source/type
  review proves the local wiring without new production machinery.
