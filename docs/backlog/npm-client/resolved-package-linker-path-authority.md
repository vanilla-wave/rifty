---
area: npm-client
status: draft
title: Resolved-package linker path authority
created: 2026-07-28
why: the terminal install-path RED proved linker and lockfile consumers can share one raw-path authority without also picking up the real installer ingress
user_story: As a browser-IDE user linking a resolved package, I want its exact node_modules scope admitted once before files, bins, or lock facts change, but today each linker consumer can trust the raw path independently
epic: honest-shadow-substitutions
sources: [ADR-0042, ADR-0261, docs/backlog/npm-client/reference/resolved-package-install-path-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
---

## Context

This is the first split successor to terminal
`npm-client/resolved-package-install-path-authority` at
`42e53d1b2c94b89fab1650794b1cff3477e8f54e`. It owns only raw
`ResolvedPackage.installPath` admission, one prepared carrier, and the
`link()`, `linkInstallTree()`, `buildLockfile()`, and
`buildInstallLockfile()` consumers in `linker.ts`. Package-private
prepared-only link and install-lock cores let the later real installer reuse
one carrier across both phases.

The serial `npm-client/resolved-package-installer-path-ingress` successor
imports this package-private authority into installer target preparation and
the real install path. Bin-claim normalization, collision state, new phases,
and launcher fault work remain in
`npm-client/package-bin-claim-linker-authority`.

## Reference contract

- A raw path is accepted only when relative and byte-canonical, rooted at a
  `node_modules` segment, and terminated by the segment-exact
  `node_modules/<package.name>` suffix.
- Omitted `installPath` means exact root `node_modules/<package.name>`.
- One package-private `preflightPackageInstallPaths()` reads each raw path
  once and returns exact `(package, relativePath, nodeModulesDir)` entries in
  input order without cloning packages.

## Acceptance

- Direct preflight returns the exact prepared shape and identities for
  omitted, root, nested, and nested-scoped paths. It remains absent from
  `src/index.ts`.
- Traversal, absolute, non-canonical, safe-relative wrong-root, wrong-owner,
  and textual-but-not-segment suffix paths reject as `EINVALIDPACKAGETAR`
  with the raw path. Wrong-root rejects with and without bin metadata.
- `link()` and `linkInstallTree()` prepare the complete set before their first
  VFS call, then delegate to one package-private
  `linkPreparedInstallTree()`. Invalid mixed input performs zero VFS
  operations; valid root and nested binful poisoned getters are read once and
  produce exact file and launcher bytes.
- `buildLockfile()` and `buildInstallLockfile()` consume the same prepared
  carrier. Invalid input publishes no package key, malformed package
  validation wins over a non-empty trusted-plan overlay conflict, and valid
  root/nested keys remain exact. Package-private
  `buildPreparedInstallLockfile()` accepts an already-prepared carrier for the
  later real installer.
- The same prepared array drives `linkPreparedInstallTree()` and
  `buildPreparedInstallLockfile()` without another raw read. Both seams remain
  absent from `src/index.ts`.
- No later linker path reads raw `ResolvedPackage.installPath` or defines a
  second validator/prepared shape. Existing tar-entry containment and
  substitution-plan path authority remain separate.

## Parity cases

1. Omitted, flat, nested, and nested-scoped packages preserve exact prepared
   values, file bytes, launcher bytes, and lock keys.
2. Every named invalid path rejects through direct preflight and all four
   linker consumers before effects.
3. Root and nested binful packages with poisoned second reads pass both linker
   entrances and both lockfile constructors; one already-prepared array also
   drives the prepared-only link and install-lock cores.
4. A malformed package outranks later linker VFS work and trusted-plan overlay
   drift.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | every named malformed path rejects with exact path before VFS or lock facts | direct matrix plus four-consumer table |
| sibling-drift | four raw consumers delegate to prepared work; the same prepared array drives file/bin and install-lock cores | poisoned-read matrix plus prepared-core identity |
| observable-order | complete package preparation precedes linker VFS work and plan overlay | all-method ledger plus non-empty overlay conflict |

## Out of scope

- Installer target preparation and real install integration; the serial
  `npm-client/resolved-package-installer-path-ingress` successor owns them.
- Bin metadata/target normalization, current/prior command ownership,
  package-file/bin phase extraction, and launcher faults;
  `npm-client/package-bin-claim-linker-authority` owns them.
- Tar-entry containment, placement policy, peer placement, lock replay, a
  public prepared-package export, new module, coordinator, scheduler, or lock.

## Decisions

- `split-predecessor:
  42e53d1b2c94b89fab1650794b1cff3477e8f54e`; predecessor checkpoints:
  `8f375ce5c5149b3ce8ff6fb9696063482c098dc0` and
  `42e53d1b2c94b89fab1650794b1cff3477e8f54e`.
- The existing `linker.ts` remains the deep package-write module. One
  package-private carrier is the minimum seam needed by its four consumers
  and the later installer ingress; prepared-only link/lock cores prevent that
  ingress from preflighting once per phase.
- This unit carries no installer fixture, package-bin collision policy, phase
  extraction, new public API, or second path owner.
