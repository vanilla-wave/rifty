---
area: npm-client
status: ready
title: Shadow recipe v2 authority — exact admission, acquisition projection, and materialized bins
created: 2026-07-26
why: the Sass RED proved recipe v1 admits unproven ranges, copies unproven registry dependencies, and can expose the acquired package bin instead of the substituted package bin; those are missing generic policy authorities, not Sass exceptions
user_story: As a browser-IDE user installing a builtin-substituted package, I want its accepted request, fetched dependency closure, visible bins, and replay provenance to be exactly the reviewed recipe, but today recipe v1 can widen each of those boundaries
epic: honest-shadow-substitutions
sources: [ADR-0310, ADR-0323]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/admission.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/linker.ts
  - packages/npm-client/src/package-bin.ts
  - tools/shadow-registry/src/internal/catalog-source.ts
  - tools/shadow-registry/src/internal/codec.ts
  - tools/shadow-registry/src/internal/model.ts
---

## Context

Recipe v1 admits semver ranges, copies registry optionals, and links acquired
bins before alias materialization. Those policies were implicit and cannot
faithfully express an exact-only package with omitted native optionals and a
loud replacement CLI. ADR-0323 supersedes ADR-0308 with one generic authority;
this prerequisite lands it without shipping the Sass recipe.

## Acceptance

- Every builtin catalog and recipe is strict clone-safe schema 2. Recipe data
  owns `semver-admits` or `exact-only` admission plus a named unsupported
  feature; rejection occurs before metadata, tarball, or VFS work.
- Registry acquisition verifies the complete required, retained optional,
  omitted optional, and peer dependency projection before tarball work. Only
  retained maps enter resolution and lockfile state; scoped package names are
  valid in every projection map.
- Recipe materialization owns the exact user-visible bin map. Acquired bins
  never leak into linking or their lock entry; one shared package-bin linker
  validates and links the materialized targets for registry and synthetic
  recipes.
- Strict ingress rejects v1, unknown/accessor/sparse data, overlapping
  dependency maps, invalid names and paths, missing or escaping bin targets,
  manifest/bin disagreement, and forged behavior-bearing digests.
- Matching v2 replay regenerates byte-identical materialization and bins with
  zero registry reads. V1 or drifted acquisition/materialization provenance
  loud-fails `EBROKENLOCK`; it is never reinterpreted.
- Existing esbuild and LightningCSS fresh/replay behavior remains faithful.
  Direct guest CJS/ESM esbuild and real Vite 7.3.6 acceptance stay green, with
  v2 lock identity and the loud esbuild CLI observed in Chromium.
- Catalog/install-artifact identities and all committed dependency snapshots
  are regenerated from v2. Add concise npm-client, shadow-registry, Workbench,
  and playground CHANGELOG entries.

## Parity cases

1. Direct `require('esbuild')` and `import('esbuild')` keep matching the pinned
   real-Node transform contract after the v2 identity change.
2. Vite 7.3.6 dev/build/preview/optimize keeps using the same admitted esbuild
   adapter; the browser lock records `rifty.shadow-substitution.esbuild.v2`.
3. Fresh and replayed esbuild materialize the same files and `.bin/esbuild`;
   invoking the unsupported CLI names `NotImplementedError('esbuild.cli')`.
4. LightningCSS accepts its current semver requests, verifies exact registry
   metadata, omits no undeclared dependency, and replays without registry I/O.
5. Synthetic contract fixtures exercise exact-only rejection and semver
   admission independently of a shipped Sass recipe.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | strict decode rejects malformed schema, projection, bin, and digest data | codec/catalog contract table |
| provenance-lie | registry metadata or lock acquisition/materialization drift rejects before reuse | installer contract faults |
| observable-order | unsupported admission rejects before registry/VFS work; dependency drift rejects before tarball work | synthetic policy and registry counters |
| cache-loss/replay | matching v2 lock replays byte-identically with zero reads; v1 loud-fails | installer replay contracts |
| torn-state | abort between alias/bin writes cannot publish a successful lock; retry rematerializes the exact recipe | installer materialization fault |
| sibling-drift | esbuild and LightningCSS share the same policy/linker path | both recipe contract suites plus source boundary gate |

## Out of scope

- The Sass recipe, facade/capsule, oracle, fixtures, compat rows, network
  measurement, and Sass/Vite acceptance.
- New runtime adapters/assets, Vite-specific admission, or package-name
  recognition in generic consumers.
- Reinterpreting recipe-v1 lockfiles or falling back to acquired/native bins.
- A public recipe/plugin API or remotely supplied executable policy.

## Decisions

- ADR-0323 owns schema 2, admission, dependency projection, bin authority, and
  loud v1 replay failure.
- The recipe model remains clone-safe data. Generic consumers execute policy
  fields and never recognize Sass, esbuild, LightningCSS, Vite, or entry kind.
- The package-bin linker is the sole bin implementation. Runtime binding stays
  optional; kernel and runtime-asset boundaries do not change.
