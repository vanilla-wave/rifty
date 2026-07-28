---
area: npm-client
status: draft
title: Shadow recipe v2 authority — exact admission, acquisition projection, and materialized bins
created: 2026-07-26
why: the Sass RED proved recipe v1 admits unproven ranges, copies unproven registry dependencies, and can expose the acquired package bin instead of the substituted package bin; those are missing generic policy authorities, not Sass exceptions
user_story: As a browser-IDE user installing a builtin-substituted package, I want its accepted request, acquired source projection, visible bins, and replay provenance to be exactly the reviewed recipe, but today recipe v1 can widen each of those boundaries
epic: honest-shadow-substitutions
sources: [ADR-0278, ADR-0310, ADR-0328, docs/backlog/npm-client/reference/lightningcss-wasm-1.32.0-packument.md, docs/backlog/npm-client/reference/npm-11-bin-collision-probe.md]
code:
  - packages/npm-client/src/installer.ts
  - packages/npm-client/src/internal/shadow/planner.ts
  - packages/npm-client/src/linker.ts
  - packages/workbench/src/workers/package-acquisition-authority.ts
  - packages/workbench/src/workers/owner-package-shadow-assets.contract.test.ts
  - tools/checks/runtime-adapter-boundary.mjs
---

## Context

Recipe v1 admits semver ranges, copies registry optionals, and links acquired
bins before alias materialization. Those policies were implicit and cannot
faithfully express an exact-only package with omitted native optionals and a
loud replacement CLI. ADR-0328 supersedes ADR-0308 with one generic authority.
The completed data-authority slice owns schema 2, strict codec/ingress, and
admission feature identity; this item starts at execution, projection,
materialization, and replay without shipping the Sass recipe.

## Reference contract

- `lightningcss-wasm@1.32.0` registry identity, integrity, dependency maps, and
  bundled `napi-wasm` membership are pinned by a machine-checked fixture
  independent of catalog source or installer fakes; future registry-backed
  builtins inherit the same external-golden differential. This unit verifies
  the current exact required bundled `napi-wasm` map plus empty optional and
  peer maps; broader dependency-projection execution is not inferred from
  mutation-only evidence.
- The committed collision probe pins same-command `.bin` ownership independent
  of manifest order and across incremental reconciliation. Browser acceptance
  remains the real esbuild/Vite contract, never a local fake of the package
  being substituted.

## Readiness evidence

- The npm 11 collision probe covers opposite manifest orders and incremental
  reconciliation in one `node_modules` scope. Both paths choose the
  lexical-min user-visible package; the registry acquisition twin is excluded
  before that policy.
- ADR-0278's origin Web Lock and sole Workbench owner package FIFO physically
  exclude alias/bin/lock writers through complete adapter settlement. This
  slice adds a real install-core same-project proof. Raw public
  `npm-client.install()` concurrency is not claimed safe; its independently
  reproduced torn-success gap is captured by
  `npm-client/public-concurrent-same-cwd-installs`.

## Acceptance

- Consume the completed clone-safe schema-2 data authority and preserve its
  `semver-admits`/`exact-only` result and named feature through every execution
  path; this item does not add a second codec or admission owner.
- Registry acquisition verifies the current exact LightningCSS projection
  before tarball work: required `napi-wasm@^1.0.1`, bundled `napi-wasm`, and
  empty optional and peer maps. The bundled member stays embedded and never
  enters ordinary registry traversal; drift in any complete map loud-fails
  with the recipe's named unsupported feature.
- Recipe materialization owns the exact user-visible bin map. Acquired bins
  never leak into linking or their lock entry; one shared package-bin linker
  validates and links the materialized targets for registry and synthetic
  recipes. For a shared command in one `node_modules` scope, the
  lexicographically first user-visible package name wins, independent of
  manifest order; every install reconciles an existing launcher to that
  winner. The acquired registry twin is suppressed before this policy runs.
- Matching v2 replay regenerates byte-identical materialization and bins with
  zero registry reads. The data slice's schema-1 identity rejection remains;
  drifted acquisition/materialization provenance loud-fails `EBROKENLOCK` and
  is never reinterpreted.
- Existing esbuild and LightningCSS fresh/replay behavior remains faithful.
  Direct guest CJS/ESM esbuild and real Vite 7.3.6 acceptance stay green, with
  v2 lock identity and the loud esbuild CLI observed in Chromium.
- Preserve the data slice's v2 catalog/install/snapshot identity migration and
  keep every drift gate green; any behavior-data change regenerates its derived
  artifacts in this PR. Add concise npm-client, shadow-registry, Workbench, and
  playground CHANGELOG entries.
- Two supported Workbench installs targeting one project remain physically
  serialized through the existing owner FIFO until materialized files, bins,
  and the lock commit settle; the second install cannot enter the real
  npm-client core while the first is parked before its lock write.

## Parity cases

1. Direct `require('esbuild')` and `import('esbuild')` keep matching the pinned
   real-Node transform contract after the v2 identity change.
2. Vite 7.3.6 dev/build/preview/optimize keeps using the same admitted esbuild
   adapter; the browser lock records `rifty.shadow-substitution.esbuild.v2`.
3. Fresh and replayed esbuild materialize the same files and `.bin/esbuild`;
   invoking the unsupported CLI names `NotImplementedError('esbuild.cli')`.
4. LightningCSS accepts its current semver requests, verifies exact registry
   metadata, consumes only its embedded bundled `napi-wasm`, and replays
   without registry I/O.
5. The committed LightningCSS recipe exercises exact required bundled
   dependency metadata and the committed esbuild recipe exercises a
   materialized bin through the real install core; no injected/custom recipe
   SPI or fake package is added.
6. Opposite manifest order and incremental-install fixtures match the committed
   npm 11 collision probe: the lexicographically first user-visible package
   name owns a shared command, while an acquired registry twin never
   participates.

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
| observable-order / sibling-drift | shared commands choose the lexical-min user-visible package independently of manifest order and reconcile incremental installs; acquired twins are absent | opposite-order + incremental collision fixtures against npm 11 probe |
| concurrent-same-key | two Workbench installs target one project while the first is parked before lock publication | existing owner FIFO admits the second only after the first's alias/bin/lock writes settle; exact final recipe, launcher, and lock agree |

## Out of scope

- The Sass recipe, facade/capsule, oracle, fixtures, compat rows, network
  measurement, and Sass/Vite acceptance.
- New runtime adapters/assets, Vite-specific admission, or package-name
  recognition in generic consumers.
- Reinterpreting recipe-v1 lockfiles or falling back to acquired/native bins.
- A public recipe/plugin API or remotely supplied executable policy.
- Matching non-bundled required and retained-optional traversal, omitted
  optional suppression, non-empty peer metadata handoff, and accepted scoped
  keys in every projection map. The required goal child
  `npm-client/shadow-recipe-v2-dependency-projection-execution` owns that
  executable positive authority.
- Traversing, resolving, placing, or replaying peer dependency trees. Exact
  non-empty peer metadata handoff belongs to the dependency-projection child;
  npm execution authority is the required goal child
  `npm-client/npm-11-peer-placement-authority`.
- Concurrent-safe raw public `npm-client.install()` calls; the supported
  Workbench product boundary physically excludes them and the generic SDK gap
  is captured separately.

## Decisions

- ADR-0328 owns the complete recipe authority. The completed data-authority
  slice owns schema 2, codec/ingress, admission, and the schema-1 replay guard;
  this item owns projection execution, materialized-bin execution, and v2
  acquisition/materialization provenance.
- The recipe model remains clone-safe data. Generic consumers execute policy
  fields and never recognize Sass, esbuild, LightningCSS, Vite, or entry kind.
- The package-bin linker is the sole bin implementation. Runtime binding stays
  optional; kernel and runtime-asset boundaries do not change.
- The current empty peer projection stays in this acquisition unit. The
  earlier second Contract+RED blocker split peer traversal, placement,
  conflicts, peer lock facts, and replay into
  `npm-client/npm-11-peer-placement-authority`.
- Narrowed checkpoint `5c450fb9` rejected a prescribed acquisition module, a
  stale installer sibling, and an incomplete generic-source gate. The re-cut
  removes that carrier, makes the sibling's bundled traversal observable, and
  scans the finite admission/installer/linker/planner consumer surface.
- Narrowed checkpoint `b7725a3e` rejected the remaining broad projection
  claims: the positive LightningCSS oracle has one required bundled dependency
  and empty optional/peer maps, so mutation-only RED cannot prove non-bundled
  traversal, omission, non-empty peer handoff, or accepted scoped keys. The
  binding second-checkpoint split preserves those clauses in
  `npm-client/shadow-recipe-v2-dependency-projection-execution`.
- The committed owner-decoded builtin catalog drives the real install core in
  contract tests. The public root export remains builtin-only; remote/custom
  recipes cannot reach executable policy.
