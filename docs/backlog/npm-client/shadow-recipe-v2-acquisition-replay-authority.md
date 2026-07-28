---
area: npm-client
status: draft
title: Shadow recipe v2 acquisition and replay authority
created: 2026-07-28
why: the blocked recipe-v2 predecessor proved the current LightningCSS registry twin is neither verified as an exact acquisition nor consumed as one embedded bundle, and incomplete lock evidence can replay forged materialization
user_story: As a browser-IDE user installing a registry-backed substitution, I want the exact reviewed source, embedded dependency, materialized bytes, bins, and offline replay to agree before success, but today rifty fetches the bundled child separately and trusts incomplete provenance
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-materialized-bin-commit-authority]
sources: [ADR-0335, docs/backlog/npm-client/reference/lightningcss-wasm-1.32.0-packument.md]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/installer-lockfile-reader.ts
  - packages/npm-client/src/linker.ts
  - packages/workbench/src/workers/package-acquisition-authority.ts
---

## Context

This is the serial acquisition/replay successor to blocked predecessor
`npm-client/shadow-recipe-v2-authority` / PR #212. It starts only after
`npm-client/shadow-materialized-bin-commit-authority` lands and remains
deliberately unmapped from the epic Items/Budget until its own pre-pickup
Contract+RED window.

The existing installer/planner seam owns source projection, embedded-bundle
evidence, alias publication, lock trace, and replay. The materialized-bin
successor chain supplies one settled linker/commit boundary; this item adds no
codec, catalog, resolver, cache, lock, FIFO, or public recipe owner.

## Reference contract

- `lightningcss-wasm@1.32.0` registry identity, integrity, complete dependency
  maps, bundled `napi-wasm` membership, and embedded `napi-wasm@1.1.3` bytes
  are pinned by a committed machine-checked fixture independent of catalog
  source or installer fakes.
- The completed schema-2 data authority owns recipe codec, catalog identity,
  admission mode/feature, and schema-1 identity detection. This successor
  consumes those facts and adds protocol-v2 execution provenance.

## Acceptance

- Consume the completed clone-safe schema-2 data authority and preserve its
  `semver-admits`/`exact-only` result and named feature through every execution
  path; this item does not add a second codec or admission owner.
- Registry acquisition verifies the current exact LightningCSS projection
  before tarball work: required `napi-wasm@^1.0.1`, bundled `napi-wasm`, and
  empty optional and peer maps. Removing or changing any required member, or
  drifting any complete map, loud-fails the recipe's named feature before
  tarball, cache, VFS, tree, report, or lock work.
- The bundled member stays embedded under
  `lightningcss-wasm/node_modules/napi-wasm`; its manifest names
  `napi-wasm@1.1.3`. It never enters ordinary registry traversal, cache, or a
  root install. Fresh lock facts record exact acquisition dependencies and
  bundle membership plus the child's exact version and `inBundle: true`.
- Acquired registry-twin bins remain absent from disk and acquisition lock
  facts. Registry alias materialization uses the materialized-bin successor's
  phase and commit authority; its exact files and bin map settle before
  substitution reporting and lock publication.
- The lock trace protocol is `rifty.shadow-substitutions/v2` and carries the
  exact schema-2 catalog/recipe, acquisition, materialization files, and
  materialization bin-map facts. The data slice's schema-1 identity rejection
  still runs before generic protocol rejection and names its canonical-first
  package.
- Matching v2 replay regenerates byte-identical acquisition, aliases, and bins
  with zero packument/tarball reads and leaves exact lock bytes unchanged.
  Independently drifting acquisition `dependencies`, `bundleDependencies`,
  bundled-child `version` or `inBundle`, or `materialization.bin` loud-fails
  `EBROKENLOCK` before registry, cache, VFS, report, or lock mutation.
- Existing esbuild and LightningCSS fresh/replay behavior remains faithful.
  Direct guest CJS/ESM esbuild and real Vite 7.3.6
  dev/build/preview/optimize remain green in Chromium with v2 lock identity,
  exact `.bin/esbuild`, and the loud esbuild CLI.
- Two supported Workbench installs targeting one project remain physically
  serialized through the existing owner FIFO until materialized files, bins,
  reports, and lock commit settle; the second cannot enter the real
  npm-client core while the first is parked before lock publication.
- Preserve the completed v2 catalog/install/snapshot identity migration and
  every drift gate. Add concise npm-client, shadow-registry, Workbench, and
  playground CHANGELOG entries.

## Parity cases

1. Direct `require('esbuild')` and `import('esbuild')` keep matching the pinned
   real-Node transform contract after the v2 identity change.
2. Vite 7.3.6 dev/build/preview/optimize keeps using the same admitted esbuild
   adapter; the browser lock records `rifty.shadow-substitution.esbuild.v2`.
3. Fresh and replayed esbuild materialize the same files and `.bin/esbuild`;
   invoking the unsupported CLI names `NotImplementedError('esbuild.cli')`.
4. LightningCSS accepts its current semver requests, verifies exact registry
   maps, consumes only embedded `napi-wasm@1.1.3`, and creates no standalone
   registry/cache/tree entry for the bundled child.
5. Deleting required `napi-wasm` or mutating each acquisition, bundle-child,
   and materialization-bin fact independently rejects before tarball or replay
   effects.
6. Matching v2 replay is byte-identical and offline; schema-1 rejection keeps
   canonical package attribution before protocol mismatch.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input / provenance-lie | complete registry maps and every v2 acquisition/materialization field strict-compare; missing required members reject too | independent map deletion/change and replay-mutation tables |
| observable-order | admission precedes registry; projection precedes tarball/cache/VFS; replay validation precedes registry/cache/VFS/report | operation ledgers on direct and replay paths |
| unbounded-read | registry headers/bodies remain progress-bounded, runaway bodies capped, discarded responses cancelled | inherited `RegistryClient` fault suite (8/8) |
| poisoned-cache / provenance-lie | exact replay reads only pinned acquisition bytes; lock/tar embedded-child disagreement rejects before link | offline replay plus bundle-child version mutations |
| torn-state | parked alias abort stops later writes, emits no report/result/lock, and exact retry reconciles | root/nested alias write ledger |
| quota-perm-fail | alias `ENOSPC`/`EACCES` emits no report/result/lock and exact retry reconciles | root/nested alias fault table |
| concurrent-same-key | two Workbench installs target one project while the first is parked before lock publication | existing owner FIFO admits the second only after complete installer settlement |
| sibling-drift | direct/transitive/fresh/replay/Eddy ingress share generic recipe and projection owners | data-authority matrix plus finite generic-source gate |

## Out of scope

- npm same-command collision settlement; it remains
  `NotImplementedError('npm-client.bin-collision-reify')` + compat ❌ and is
  tracked by `npm-client/npm-11-bin-reify-authority`.
- Matching non-bundled required and retained-optional traversal, omitted
  optional suppression, non-empty peer handoff, and accepted scoped keys;
  `npm-client/shadow-recipe-v2-dependency-projection-execution` owns them.
- Peer traversal/placement/replay, the Sass recipe, a public/custom recipe SPI,
  raw concurrent public `install()`, or any second resolver, cache, lock, FIFO,
  or coordination mechanism.

## Decisions

- `split-predecessor:
  87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`; checkpoint lineage:
  `8f3251e89020772f15ff5a13022e7f7310f703d2`,
  `d5ffb3d2de8a27b26a13f541d2e5d16260d4b8d8`,
  `5c450fb9a5cab66a45b24eb8b19a1729c622e5a9`,
  `b7725a3e88278f4f24efb1d8c8d90e80de08de43`,
  `092d931a533ea45fa060367bd9373f78a7f2c684`, and
  `87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`.
- The installer/planner seam is one deep module: exact source projection,
  embedded-bundle evidence, alias publication, trace, and replay stay local
  behind the existing install interface.
- `materialization.bin` is protocol-v2 behavior data. The preceding successor
  executes the same catalog fact without creating another trace owner.
- The original acquisition entry retains its complete required map for lock
  fidelity while ordinary traversal filters verified bundled members.
