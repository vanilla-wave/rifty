# Resolved-package install-path Contract+RED

Recorded 2026-07-28 on the fresh first successor to terminal
`npm-client/package-bin-linker-authority@8e1456665a3d7a77425b5afa8f0c802ac59162b5`.
No production source differs from `origin/main`.

## Executable RED

```sh
pnpm vitest run \
  packages/npm-client/src/linker-install-path-authority.contract.test.ts
```

The focused suite pins exact prepared shape; traversal, absolute,
non-canonical, wrong-root binless/binful, and wrong-owner paths; both linker
entrypoints preparing a mixed valid/invalid set before the first VFS call;
wrong-root behavior through both lockfile constructors; and a finite
single-owner source topology. Exact RED/GREEN counts are recorded from the
formatted checkpoint: 19 tests, 19 RED and 0 GREEN.

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
the finite `packageLinkTargets` call gate cover that raw trust boundary without
injecting an impossible resolver state. The future claim/phased-linker
successor must accept only the prepared carrier and restore its separately
allocated terminal REDs.
