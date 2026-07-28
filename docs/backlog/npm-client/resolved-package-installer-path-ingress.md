---
area: npm-client
status: draft
title: Resolved-package installer path ingress
created: 2026-07-28
why: the terminal install-path RED proved the real installer is a separate raw package-path ingress that must consume the linker carrier instead of duplicating its validation
user_story: As a browser-IDE user installing a package, I want installer target preparation to reuse the exact linker-approved scope before project files or the lock change, but today it can trust the raw path separately
epic: honest-shadow-substitutions
sources: [ADR-0042, ADR-0261, docs/backlog/npm-client/reference/resolved-package-install-path-contract-red.md]
code:
  - packages/npm-client/src/installer.ts
---

## Context

This is the second serial split successor to terminal
`npm-client/resolved-package-install-path-authority` at
`42e53d1b2c94b89fab1650794b1cff3477e8f54e`. It starts after
`npm-client/resolved-package-linker-path-authority` lands and consumes that
unit's exact package-private `(package, relativePath, nodeModulesDir)` carrier.
It adds no installer-local validator or carrier.

Package-bin claim/phased-linker work starts only after this ingress lands.
Tar-entry containment, resolver placement, and substitution planning retain
their existing authorities.

## Reference contract

- The real installer invokes linker preflight once after acquisition. Target
  preparation, package linking, and lock construction accept that exact
  carrier; raw `ResolvedPackage.installPath` has one authority in `linker.ts`.
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
- Every malformed path owned by the predecessor rejects through the real
  installer preflight with its raw path and no target publication.
- A real install mixing a valid package with an invalid traversal package
  rejects before any post-acquisition VFS operation, project tree, or lock
  publication. The existing valid installer suite remains byte-identical.
- No installer helper defines another raw-path grammar or prepared shape.

## Parity cases

1. Direct installer targets consume the linker carrier for omitted, root,
   nested, and nested-scoped packages in input order.
2. Valid root/nested binful poisoned packages are preflighted once, then yield
   exact targets from the same carrier without another raw read.
3. Direct malformed inputs and the real mixed install reject
   `EINVALIDPACKAGETAR` before project-tree or lock effects.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | real installer preflight rejects every inherited malformed path with exact raw path | mixed-install table |
| sibling-drift | one prepared array reaches targets, link, and lock; installer defines no parallel validator/shape | poisoned-read target table plus real-install phase identity |
| observable-order | real install validates every resolved target before post-acquisition mutation | all-method VFS ledger |

## Out of scope

- Raw grammar or a second carrier; the predecessor owns both.
- Package-file/bin phases, bin claims/collisions, and launcher faults;
  `npm-client/package-bin-claim-linker-authority` owns them.
- Tar-entry containment, resolver placement, peer placement, replay, a public
  path API, new module, coordinator, scheduler, or lock.

## Decisions

- `split-predecessor:
  42e53d1b2c94b89fab1650794b1cff3477e8f54e`; predecessor checkpoints:
  `8f375ce5c5149b3ce8ff6fb9696063482c098dc0` and
  `42e53d1b2c94b89fab1650794b1cff3477e8f54e`.
- This unit consumes the linker-owned carrier directly. A second installer
  validator, carrier, or per-phase preflight would preserve the terminal
  sibling-drift fault.
- The real install proof remains an integration sibling, not a new placement
  policy or resolver state.
