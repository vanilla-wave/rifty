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

The terminal second checkpoint at
`42e53d1b2c94b89fab1650794b1cff3477e8f54e` blocked three exact residuals:

1. The independent ingress table did not force `link()`, `linkInstallTree()`,
   both lockfile constructors, `packageLinkTargets()`, and real install through
   one prepared carrier.
2. Valid poisoned packages were binless, so a root/nested CLI could reread raw
   `installPath` during bin linking without failing exact launcher or target
   observations.
3. The linked terminal recipe-v2 contract still claimed lexical-min /
   every-install collision settlement after ADR-0335 superseded that static
   model.

The third residual is corrected in the frozen predecessor contract. The first
two split serially: `resolved-package-linker-path-authority` owns direct
preflight plus the four `linker.ts` consumers; then
`resolved-package-installer-path-ingress` consumes the same carrier in
installer targets and real install. The predecessor gets no third review.

## Successor RED plan

The initial linker successor RED retains the exact path grammar and
all-method/overlay order proofs, then forces omitted/root/nested/scoped and
valid root/nested binful poisoned packages through direct preflight, both
linker entrances, and both lockfile constructors. One already-prepared array
must also drive package-private link and install-lock cores. The suite observes
exact prepared identities, file/launcher bytes, lock keys, one raw read, and
zero effects for malformed mixed input. Its focused run records 30 tests,
30 RED and 0 GREEN before production pickup.

After that unit lands, the installer successor RED will route the same carrier
through `packageLinkTargets()` and the real mixed install: one post-acquisition
preflight produces the array consumed by targets, prepared linking, and
prepared lock construction. It covers exact targets, valid binful poisoned
getters, and zero post-acquisition VFS or lock effects on rejection. Test
counts remain unrecorded until each successor's committed run.

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
