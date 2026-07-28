# Package-bin linker Contract+RED

Recorded 2026-07-28 on the fresh split successor to terminal predecessor
`npm-client/shadow-materialized-bin-authority@9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`.
No production source differs from `origin/main`. Shadow recipe integration,
aliases, shims, lock publication, and reporting are absent from this unit.

## Executable RED

```sh
pnpm vitest run \
  packages/npm-client/src/linker-bin-authority.contract.test.ts
```

Initial checkpoint
`83ea4bf28e880eaf6c581de69731548860c318a5`: 18 tests, 16 RED and 2 GREEN.
Contract+RED review blocked the missing detached-claim, current-target,
install-path ingress, and single-composer proofs.

Current re-cut result: 28 tests, 24 RED and 4 GREEN.

- opposite current input orders in root and nested scopes write plausible
  launchers instead of rejecting
  `NotImplementedError('npm-client.bin-collision-reify')` before VFS mutation;
- public `link()` interleaves the first package launcher before later package
  files instead of settling all package files first;
- the package-private file phase, normalized-claim bin phase, and current/prior
  preflight seams do not exist;
- the finite topology and detached-claim sentinels reject a duplicate or unused
  phased writer; root/string and nested/object cases require one normalization
  and one target read / launcher write through public, install-tree, and phased
  entrypoints;
- prior-owner transition, removal, and recorded-prior-collision cases
  therefore have no generic loud boundary; a stable prior owner cannot yet
  return and link only the current target;
- absolute and traversal install paths retaining the expected package suffix
  reach VFS mutation through public and install-tree entrypoints, while the
  missing preflight and package-file phases cannot reject them;
- escaping bin targets reject only after project-tree mutation;
- root/nested target-read abort and launcher `ENOSPC` / `EACCES` retry tables
  remain RED until they can enter the missing shared bin phase.

The four GREEN cases retain honest behavior: the same command in independent
root and nested scopes produces two exact launchers; existing public and
install-tree paths each make exactly one target read and launcher write per
non-colliding claim; and a missing target stays loud without writing its
launcher.

## Sibling gates

```sh
pnpm vitest run packages/npm-client/src/linker.test.ts
pnpm vitest run packages/npm-client/src/installer.test.ts
pnpm check:runtime-adapter-boundary
pnpm backlog:check
```

The inherited linker suite remains the regression floor. The runtime boundary
gate keeps package-specific shadow names and branches out of the generic
linker. The installer suite keeps its independent ADR-0261 ingress safety
green, including a resolved scoped-name traversal rejected before project-tree
mutation. The serial shadow commit successor must separately prove that real
recipe claims use these phases; this generic unit does not infer integration
from a source grep.
