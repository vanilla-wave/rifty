---
area: npm-client
status: draft
title: Shadow recipe v2 authority — exact admission, acquisition projection, and materialized bins
created: 2026-07-26
why: the Sass RED proved recipe v1 admits unproven ranges, copies unproven registry dependencies, and can expose the acquired package bin instead of the substituted package bin; those are missing generic policy authorities, not Sass exceptions
user_story: As a browser-IDE user installing a builtin-substituted package, I want its accepted request, fetched dependency closure, visible bins, and replay provenance to be exactly the reviewed recipe, but today recipe v1 can widen each of those boundaries
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-recipe-v2-data-authority]
sources: [ADR-0310, ADR-0328]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/linker.ts
  - packages/npm-client/src/package-bin.ts
---

## Context

Recipe v1 admits semver ranges, copies registry optionals, and links acquired
bins before alias materialization. Those policies were implicit and cannot
faithfully express an exact-only package with omitted native optionals and a
loud replacement CLI. ADR-0328 supersedes ADR-0308 with one generic authority;
this prerequisite lands it without shipping the Sass recipe. The blocked data
slice owns schema 2, strict codec/ingress, and admission feature identity; this
item starts at execution, projection, materialization, and replay.

## Reference contract

- Before ready, registry-backed builtin projections must be pinned to committed
  npm packument goldens keyed by package, exact version, registry source,
  integrity, and captured date.
- The `lightningcss-wasm@1.32.0` golden must compare all four dependency maps to
  the recipe independently of catalog source or installer fixtures; future
  registry-backed builtins inherit the same external-golden differential.
- Real npm must pin peer placement/traversal and same-command `.bin`
  ownership/order. Browser acceptance remains the real esbuild/Vite contract,
  never a local fake of the package being substituted.

## Readiness blockers

- Commit a reproducible exact `lightningcss-wasm@1.32.0` registry capture
  (source, integrity, date, and all four dependency maps); the referenced
  golden does not exist yet.
- Add the real-npm peer placement/traversal differential this contract
  references; current peer tests use the fake registry and do not settle
  traversal.
- Pin real npm's same-command `.bin` winner/order, then specify how a
  materialized alias participates. Existing package-order overwrite is not an
  oracle.
- Add `concurrent-same-key` coverage or a proven physical exclusion for
  alias/bin/lock writes before this production-tier storage slice becomes
  ready.

## Acceptance

- Consume the completed clone-safe schema-2 data authority and preserve its
  `semver-admits`/`exact-only` result and named feature through every execution
  path; this item does not add a second codec or admission owner.
- Registry acquisition verifies the complete required, retained optional,
  omitted optional, and peer dependency projection before tarball work. Only
  retained maps enter resolution and lockfile state; scoped package names are
  valid in every projection map.
- Recipe materialization owns the exact user-visible bin map. Acquired bins
  never leak into linking or their lock entry; one shared package-bin linker
  validates and links the materialized targets for registry and synthetic
  recipes.
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
5. The committed LightningCSS recipe exercises non-empty dependency policy and
   the committed esbuild recipe exercises a materialized bin through the real
   install core; no injected/custom recipe SPI or fake package is added.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | strict decode rejects malformed schema, projection, bin, and digest data | codec/catalog contract table |
| provenance-lie | registry metadata or lock acquisition/materialization drift rejects before reuse | installer contract faults |
| observable-order | unsupported admission rejects before registry/VFS work; dependency drift rejects before tarball work | synthetic policy and registry counters |
| poisoned-cache / provenance-lie | matching v2 lock replays byte-identically with zero reads; v1 or drifted evidence loud-fails | installer replay contracts |
| torn-state | abort during reachable registry alias writes stops later writes and the success claim, publishes no lock, and retry reconciles exact bytes; shared-bin cancellation remains inherited | installer materialization fault plus linker fault suite |
| quota-perm-fail | quota/permission rejection during alias or bin writes publishes no success report or lock; retry reconciles exact bytes | root/nested registry alias and shared-bin write faults |
| sibling-drift | esbuild and LightningCSS share the same policy/linker path | both recipe contract suites plus source boundary gate |

## Out of scope

- The Sass recipe, facade/capsule, oracle, fixtures, compat rows, network
  measurement, and Sass/Vite acceptance.
- New runtime adapters/assets, Vite-specific admission, or package-name
  recognition in generic consumers.
- Reinterpreting recipe-v1 lockfiles or falling back to acquired/native bins.
- A public recipe/plugin API or remotely supplied executable policy.

## Decisions

- ADR-0328 owns the complete recipe authority. The blocked data slice owns
  schema 2, codec/ingress, and admission; this item owns projection execution,
  materialized-bin execution, provenance, and loud v1 replay failure.
- The recipe model remains clone-safe data. Generic consumers execute policy
  fields and never recognize Sass, esbuild, LightningCSS, Vite, or entry kind.
- The package-bin linker is the sole bin implementation. Runtime binding stays
  optional; kernel and runtime-asset boundaries do not change.
- The committed owner-decoded builtin catalog drives the real install core in
  contract tests. The public root export remains builtin-only; remote/custom
  recipes cannot reach executable policy.
