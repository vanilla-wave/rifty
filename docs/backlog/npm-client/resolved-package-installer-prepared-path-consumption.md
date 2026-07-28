---
area: npm-client
status: ready
title: Resolved-package installer prepared-path consumption
created: 2026-07-28
why: the terminal installer-ingress RED proved its public behavior must be separated from an unobservable package-reference identity claim while the installer still rereads raw paths before target publication
user_story: As a browser-IDE user installing a package, I want every target, file, and lock fact to consume one linker-approved path before the project changes, but today target preparation can publish a normalized malformed path first
epic: honest-shadow-substitutions
sources: [ADR-0042, ADR-0261, docs/backlog/npm-client/reference/resolved-package-install-path-contract-red.md]
code:
  - packages/npm-client/src/installer.ts
---

## Context

This is the re-refined successor to terminal
`npm-client/resolved-package-installer-path-ingress` at
`30abc22f61d3b5753cb7c65bb6bd75d8e88064ea`. The landed linker supplies the
package-private `(package, relativePath, nodeModulesDir)` carrier. This unit
owns only its real-installer consumption across portable targets, prepared
linking, and prepared lock construction.

The carrier never crosses a public callback. Observable tests therefore prove
exact target/error/effect behavior and absence of raw-path rereads; Final
source/type review proves the one local prepared binding. No mock, test hook,
installer-local validator, or second carrier ships.

Package-bin claim/phased-linker work starts only after this unit lands.
Tar-entry containment, resolver placement, and substitution planning retain
their existing authorities.

## Reference contract

- `preflightPackageInstallPaths()` remains the only raw package-path authority.
  The real installer invokes it after acquisition and before target
  publication or VFS mutation.
- Package-private `packageLinkTargets()` consumes prepared relative paths and
  package file/bin facts without reading raw `ResolvedPackage.installPath`.
- Prepared targets, linking, and lock construction retain exact existing
  bytes/order. Malformed reachable paths reject as `EINVALIDPACKAGETAR` before
  project-tree or lock mutation.

## Acceptance

- Package-private `packageLinkTargets()` accepts prepared packages, remains
  absent from `src/index.ts`, and derives exact ordered absolute targets for
  omitted, root, nested, and nested-scoped packages without another raw-path
  read.
- Real install calls `preflightPackageInstallPaths()` once after acquisition,
  then uses the resulting local for `packageLinkTargets()`,
  `linkPreparedInstallTree()`, and `buildPreparedInstallLockfile()`. The local
  wiring is a Final source/type proof because it is not publicly observable.
- Valid root/nested binful poisoned getters are read once while target,
  launcher, and lock observations stay exact.
- Every malformed path physically reachable through the supported real
  installer entrance — traversal, dot segment, double separator, and trailing
  separator — rejects through linker preflight with its raw path.
  `assertPortablePaths` is not invoked; the full raw malformed matrix remains
  at the linker boundary.
- A real install mixing a valid package with an invalid package rejects before
  any post-acquisition VFS operation, project tree, or lock publication. The
  existing valid installer suite remains byte-identical.
- No installer helper defines another raw-path grammar or prepared shape.

## Parity cases

1. Prepared omitted, root, nested, and nested-scoped packages yield exact
   targets in input order without a second raw-path read.
2. One prepared root/nested binful set yields exact targets, launchers, and
   lock keys after one raw read.
3. Real mixed installs with reachable traversal, dot-segment, double-separator,
   and trailing-separator paths reject `EINVALIDPACKAGETAR` before target,
   project-tree, or lock effects.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | real installer preflight rejects every reachable malformed path with exact raw path; impossible raw shapes stay covered at linker ingress | mixed-install table plus inherited linker matrix |
| sibling-drift | targets accept the linker carrier and never reread raw paths; the installer has one prepared local across target/link/lock consumers | poisoned-read prepared composition plus Final source/type review |
| observable-order | real install validates every resolved target before target or VFS publication | all-method VFS and target ledgers |

## Out of scope

- Raw grammar or a second carrier; the landed linker owns both.
- Package-reference identity through a string-only target result; it has no
  honest public observation and needs no production hook.
- Package-file/bin phases, bin claims/collisions, and launcher faults;
  `npm-client/package-bin-claim-linker-authority` owns them.
- Tar-entry containment, resolver placement, peer placement, replay, a public
  path API, new module, coordinator, scheduler, or lock.

## Decisions

ready-verdict: 2026-07-28 — Contract+RED @ 5647f070964a5d83db550b4f18679ad20cb1099b

- `split-predecessor:
  30abc22f61d3b5753cb7c65bb6bd75d8e88064ea`; predecessor checkpoints:
  `b9bd5b4e977c48182c00bdb51d2c6331675641a9` and
  `30abc22f61d3b5753cb7c65bb6bd75d8e88064ea`.
- Re-refinement removes only an internal, non-observable identity assertion.
  Frozen installer outcomes, path grammar, error priority, and zero-effect
  rejection remain unchanged.
- The existing `installer.ts` stays the orchestration owner and imports the
  linker-owned prepared seam directly.
