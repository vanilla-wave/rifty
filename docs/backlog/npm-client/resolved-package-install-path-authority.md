---
area: npm-client
status: draft
title: Resolved-package install-path authority
created: 2026-07-28
why: the terminal package-bin linker RED proved a safe-relative wrong package suffix can reach file or lock mutation because ResolvedPackage.installPath has no single raw ingress authority
user_story: As a browser-IDE user installing a package, I want every resolved package path contained in its exact node_modules scope before files or lock facts change, but today a malformed relative path can write elsewhere in the project
epic: honest-shadow-substitutions
sources: [ADR-0042, ADR-0261, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md, docs/backlog/npm-client/reference/resolved-package-install-path-contract-red.md]
code:
  - packages/npm-client/src/linker.ts
  - packages/npm-client/src/installer.ts
---

## Context

This is the first split successor to terminal
`npm-client/package-bin-linker-authority` at
`8e1456665a3d7a77425b5afa8f0c802ac59162b5`. It owns only raw
`ResolvedPackage.installPath` admission and the minimum prepared carrier used
by existing linker, lockfile, and installer ingress. Package-bin
normalization, collision state, phased file/bin linking, launcher faults, and
compat stay in the serial
`npm-client/package-bin-claim-linker-authority` successor.

ADR-0042 already fixes placement as root `node_modules/<name>` or a nested
`.../node_modules/<name>`. ADR-0261 already requires complete package targets
to be contained before install mutation. This unit adds no placement policy,
module, scheduler, lock, or public API.

## Reference contract

- A raw path is accepted only when it is relative and byte-canonical, starts
  under `node_modules/`, ends in the exact `node_modules/<package.name>`
  suffix, and derives a root or nested `node_modules` scope.
- Omitted `installPath` means exact root `node_modules/<package.name>`.
- The package-private prepared shape is exactly
  `(package, relativePath, nodeModulesDir)`. It preserves input order and
  package identity so later phases never reread an untrusted path.

## Acceptance

- One package-private `preflightPackageInstallPaths()` reads each raw
  `installPath` once and returns exact prepared entries for omitted, root,
  nested, and scoped package paths. It remains absent from `src/index.ts`.
- Safe-relative wrong-root `packages/bad-cli`, wrong-owner
  `node_modules/other-cli`, traversal retaining the package suffix, and an
  absolute path retaining the suffix reject as `EINVALIDPACKAGETAR` with the
  raw path. The wrong-root case is covered with and without bin metadata.
- Existing public `link()` and package-private `linkInstallTree()` prepare the
  complete package set before their first VFS call. Rejection performs zero
  `mkdir` or `writeFile`; valid root/nested linking remains byte-identical.
- Public `buildLockfile()` consumes prepared paths, never publishes a malformed
  resolved-package key, and retains exact valid keys. Installer-only
  `buildInstallLockfile()` delegates those package inputs through it before
  its existing trusted-plan overlay. The real installer target preflight uses
  the same seam before `node_modules` or lock mutation; tar-entry containment
  stays its separate responsibility.
- The later bin-claim successor may create file/bin phases only over prepared
  packages. No new phase may become another raw `installPath` ingress.

## Parity cases

1. Omitted, flat, nested, and nested-scoped paths prepare to their exact
   relative path and owning `node_modules` directory without package cloning.
2. Traversal, absolute, wrong-root, and wrong-owner paths reject through
   the shared preflight; wrong-root additionally rejects through public link,
   install-tree link, and both lockfile constructors before effects, with and
   without bin metadata.
3. The existing real installer traversal fixture rejects
   `EINVALIDPACKAGETAR` before `node_modules`, escape-path, or lock creation.
4. Valid public linker and lockfile fixtures remain byte-identical.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | every named malformed raw path rejects with exact path before VFS or lock mutation | prepared-path matrix across existing raw ingresses |
| sibling-drift | linker, lockfile, and installer target preflight consume one package-private prepared shape; future phases accept only it | finite source gate plus real installer sibling |
| observable-order | the complete package set prepares before the first linker VFS call | first-operation ledger |

## Out of scope

- Bin metadata/target normalization, current/prior command ownership,
  package-file/bin phase extraction, launcher bytes, and their abort/quota
  faults; `npm-client/package-bin-claim-linker-authority` owns them.
- Tar-entry containment, package-name grammar, registry placement, peer
  placement, lock replay, or npm same-command reify behavior.
- A public prepared-package export, new module, whole-install plan,
  coordinator, scheduler, lock, or package-specific branch.

## Decisions

- `split-predecessor:
  8e1456665a3d7a77425b5afa8f0c802ac59162b5`; predecessor checkpoints:
  `83ea4bf28e880eaf6c581de69731548860c318a5` and
  `8e1456665a3d7a77425b5afa8f0c802ac59162b5`.
- The prepared entry is the smallest carrier that lets linker, lockfile, and
  future phases consume one validated relative path and bin scope without
  parallel arrays or raw rereads.
- `linker.ts` remains the deep package-write module. The installer imports the
  package-private seam directly; the root package export stays unchanged.
