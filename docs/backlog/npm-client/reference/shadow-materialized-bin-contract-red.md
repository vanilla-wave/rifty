# Shadow materialized-bin Contract+RED

Recorded 2026-07-28 on the terminal successor lineage from
`#212@87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`. No production npm-client,
Workbench, or browser source differs from `origin/main`; this checkpoint adds
the split contract, ADR-0335, external npm oracle, executable RED, and generic
source gate only.

## Executable RED

```sh
pnpm vitest run \
  packages/npm-client/src/installer-bin-authority.contract.test.ts
```

Current result: 18 tests, 16 RED and 2 GREEN.

- fresh esbuild reports before the lock write;
- opposite current manifest orders, public-linker root/nested duplicates, and
  a prior-owner transition write a plausible winner instead of throwing
  `NotImplementedError('npm-client.bin-collision-reify')` before tree/report/lock;
- a LightningCSS acquisition bin leaks into the install result, disk launcher,
  and acquisition lock entry;
- root/nested alias abort continues later writes and publishes redirect plus
  materialization success; alias `ENOSPC`/`EACCES` publishes the redirect;
- real esbuild bin-read abort and `.bin` `ENOSPC`/`EACCES` publish success
  before failing.

The two GREEN cases retain honest existing behavior: equal command text in
independent root/nested scopes is not a collision, and a missing package-bin
target stays loud with no lock before an exact retry.

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
