# Resolved-package install-path Contract+RED

Recorded 2026-07-28 on the fresh first successor to terminal
`npm-client/package-bin-linker-authority@8e1456665a3d7a77425b5afa8f0c802ac59162b5`.
No production source differs from `origin/main`.

## Executable RED

```sh
pnpm vitest run \
  packages/npm-client/src/linker-install-path-authority.contract.test.ts
```

The first checkpoint at
`8f375ce5c5149b3ce8ff6fb9696063482c098dc0` recorded 19 tests, 19 RED and
0 GREEN. Review blocked five incomplete proofs: a textual-but-not-segment
`node_modules` suffix, explicit flat/unscoped-nested and omitted-read shapes,
an all-method first-VFS ledger, non-empty trusted-plan overlay priority, and
one-read behavior across every ingress. Its fixed-name AST topology gate was
both removable and incomplete.

The re-cut focused suite records 30 tests, 30 RED and 0 GREEN. It pins exact
prepared shape and identity for omitted, flat, nested, and nested-scoped
paths; traversal, absolute, non-canonical, wrong-root binless/binful,
wrong-owner, and textual-suffix rejection; an all-method VFS ledger over both
linker entrances; a real non-empty overlay conflict below malformed package
validation; and poisoned second-read sentinels through linker, both lockfile
constructors, and installer target preparation. Valid sibling rows preserve
exact file bytes, lockfile bytes, and absolute target lists.

## Sibling gates

```sh
pnpm vitest run packages/npm-client/src/linker.test.ts
pnpm vitest run packages/npm-client/src/installer.test.ts
pnpm check:runtime-adapter-boundary
pnpm backlog:check
```

The inherited linker suite is the valid-path floor. The installer suite keeps
the real scoped-name traversal fixture green before project-tree or lock
mutation. Current placement and lock replay construct candidate paths from the
package identity, so a safe-relative wrong suffix is physically excluded from
the supported full-installer entrance; both public lockfile constructors plus
the package-private `packageLinkTargets` behavioral table cover that raw trust
boundary without injecting an impossible resolver state. The future
claim/phased-linker successor must accept only the prepared carrier and restore
its separately allocated terminal REDs.
