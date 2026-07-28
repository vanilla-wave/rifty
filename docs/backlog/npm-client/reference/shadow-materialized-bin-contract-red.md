# Shadow materialized-bin Contract+RED

Recorded 2026-07-28 on the terminal successor lineage from
`#212@87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`. No production npm-client,
Workbench, or browser source differs from `origin/main`; this checkpoint adds
the split contract, ADR-0335, external npm oracle, executable RED, and generic
source gate only.

## Executable RED

From a worktree at the recorded terminal SHA:

```sh
pnpm vitest run \
  packages/npm-client/src/installer-bin-authority.contract.test.ts
```

The terminal predecessor's first checkpoint at
`4c5b583620eebb962b1ea11f355cb5f64c4aa4b8` blocked on missing
recorded-prior-collision, acquired-twin collision-exclusion, internals-shim
failure, lock-write failure, and Items/Budget evidence. The lawful re-cut at
`9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97` added those proofs and then
blocked because it still coupled generic current/prior package-bin authority
to shadow-specific materialization commit authority. The predecessor is
terminal: no third Contract+RED checkpoint is allowed.

Terminal result at
`9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`: 24 tests, 22 RED and 2 GREEN.

- fresh esbuild reports before the lock write;
- opposite current manifest orders, public-linker root/nested duplicates, and
  a recorded prior collision or prior-owner transition write a plausible winner
  instead of throwing
  `NotImplementedError('npm-client.bin-collision-reify')` before tree/report/lock;
- a LightningCSS acquisition bin leaks into the install result, disk launcher,
  and acquisition lock entry; a sibling case distinguishes its excluded claim
  from an ordinary same-command claim;
- root/nested alias abort continues later writes and publishes redirect plus
  materialization success; alias and internals-shim `ENOSPC`/`EACCES` publish
  staged substitution lines;
- real esbuild bin-read abort and `.bin` `ENOSPC`/`EACCES` publish success
  before failing; lock `ENOSPC`/`EACCES` does the same.

The two GREEN cases retain honest existing behavior: equal command text in
independent root/nested scopes is not a collision, and a missing package-bin
target stays loud with no lock before an exact retry.

## Successor allocation

- `npm-client/package-bin-linker-authority` owns package-generic current/prior
  collision preflight, root/nested scope identity, the one package-private
  phased linker surface, target validation, and the sole bin writer. Its fresh
  Contract+RED uses ordinary packages only.
- `npm-client/shadow-materialized-bin-commit-authority` owns exact recipe bin
  claims, acquired-twin suppression, package-files → registry-aliases → one bin
  pass → internals-shims → lock → report order, and the full reachable
  alias/bin/shim/lock fault table.
- The terminal 24-case file is evidence for the split, not a shared future
  checkpoint. Each successor receives a fresh isolated Contract+RED review and
  keeps both predecessor SHAs in lineage.

## Sibling and source gates

```sh
pnpm vitest run packages/npm-client/src/linker.test.ts
pnpm check:runtime-adapter-boundary
pnpm backlog:check
```

The inherited linker suite and finite generic-source gate remain GREEN. The
gate includes installer and linker and rejects concrete esbuild,
LightningCSS/acquisition-member, Sass, and Vite names or control-flow
identifiers, so the RED cannot close through a package-specific second bin
writer.
