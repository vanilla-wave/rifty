---
area: npm-client
status: ready
title: Builtin shadow-asset catalog and exact applied-substitution plan
created: 2026-07-15
why: runtime assets need exact npm provenance, but today's textual substitution report cannot safely derive executable bytes or a stable asset-set identity
user_story: As an npm-client consumer, I want an applied substitution to produce one exact integrity-pinned runtime-asset plan before tree mutation
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/npm-client/0188-install-time-shadow-internals-shims-with-companion-pins-and-substitution-provenance.md, docs/adr/npm-client/0258-structured-install-acquisition-provenance.md, docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md]
code: [tools/shadow-registry/src/index.ts, tools/shadow-registry/esbuild-runtime-policy.json, tools/shadow-registry/src/install-artifact-recipe.ts, packages/npm-client/src/installer.ts, packages/npm-client/src/shadow-shims.ts, packages/npm-client/src/index.ts]
---

## Context

This is the conflict-free first implementation slice. It changes only
`tools/shadow-registry` and `packages/npm-client`; no Worker, Workbench,
Playground, storage, or runtime bootstrap file participates.

The record/plan value shape is installer-neutral, not a permanent interface to
npm-client's resolver implementation. npm-client remains the sole v0 producer
and public home; a second real installer requires its own decision rather
than a speculative producer SPI here.

## Acceptance

- Shadow registry exports a builtin, clone-safe declarative catalog with exact
  schema version, stable catalog/substitution/runtime-adapter ids, and a
  canonical digest. No function, URL, VFS, manager, or host callback is catalog
  data.
- Every admitted exact public version maps to descriptors
  `{id, source {name, version, integrity}, member, memberSha256, memberSize,
  maxTarballBytes, maxUnpackedBytes}`. The esbuild descriptor is generated from
  `esbuild-runtime-policy.json` plus the exact SRI-verified
  `esbuild-wasm@0.28.0` tarball. Caps equal the exact compressed tarball and
  decompressed archive byte lengths; they are measured/generated, never guessed.
- One typed, clone-safe, installer-neutral pre-mutation record contains only
  substitutions actually applied: catalog id/digest, public name, requested
  range, resolved exact public version, substitution id, runtime-adapter id,
  and whether the substitution was builtin. It contains no redirect/source
  target, resolver node, placement, mutable manifest/lockfile parser object,
  callback, or VFS handle. Asset source coordinates come only from the exact
  catalog descriptor. Text rendered by `onSubstitution`, including the current
  alias target, is presentation and never planner input.
- npm-client's fresh-resolution and exact-lockfile paths are the only v0
  producers. Each converts its internal facts to the same record before
  planning; planner tests consume that value interface rather than either
  producer's internal types.
- npm-client exports a builtin-only pure planner. It accepts the typed exact
  record, validates catalog/source conflicts, resolves only exact version maps,
  sorts/deduplicates descriptors, and returns one deeply frozen
  `ShadowAssetPlan {requiredSetDigest, substitutions, assets}`. Empty input
  returns the canonical empty plan.
- An admitted substitution without an exact map loud-throws
  `NotImplementedError('shadow-registry.<name>@<version>.assets')`. A source
  package/version matching any builtin trigger or baked override throws typed
  `ESHADOWASSETSOURCE` at catalog construction.
- Explicit user overrides and direct installs do not acquire builtin
  substitution provenance merely because their installed target matches one.
  Fresh resolve and exact lockfile-package facts produce byte-identical plans;
  no semver inference or app-global state participates.
- Asset-only descriptor fields and pins are excluded from
  `installArtifactIdentity`; overlay bytes, synthesized package recipe,
  generated runtime JS, and other tree-affecting inputs remain included. A pin
  change flips only `requiredSetDigest`.
- Generated catalog/manifest drift gates every descriptor and identity field.
  The public planner/types are exported only from `@riftydev/npm-client`;
  external catalogs and runtime-adapter construction remain their draft item.

## Observable proof

1. Exact builtin esbuild substitution produces one descriptor for
   `esbuild-wasm@0.28.0/package/esbuild.wasm`, member size 13,918,738 and the
   policy sha256.
2. Fresh and lockfile exact facts produce the same canonical plan/digest.
   Reordering, duplicates, and textual reporter changes do not affect it.
3. Explicit override, direct target install, unmapped version, source collision,
   malformed descriptor, and asset-only pin change each prove the named outcome.
4. Generator re-download with the pinned SRI either reproduces every committed
   field or fails the drift gate.

## Parity cases

1. Planned member bytes/hash equal the member extracted from the real pinned npm
   tarball.
2. With no applied substitution, npm-client's existing tree request, lockfile,
   artifact identity, and result remain byte-for-byte unchanged.

## Fault matrix

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `corrupt-input` | malformed catalog/member/hash/SRI/size | construction throws before plan publication |
| `lossy-aggregate` | same count, changed descriptor/pin/order | canonical digest changes exactly for semantic input |
| `provenance-lie` | explicit override/direct install resembles builtin target | no builtin applied-substitution claim |
| `sibling-drift` | fresh/replay producer shape or planner diverges | one value record over the same exact facts; no internal type crosses the seam |

## Out of scope

- Fetch, extraction, VFS persistence, receipts, progress, or MessagePort.
- Workbench/owner composition, install stamp v4, and runtime capability wiring.
- External catalogs or runtime-adapter functions.
- Native npm/pnpm/yarn adoption or a public substitution-record producer SPI.
- Delegate materialization and lockfile provenance shape; alias retirement and
  its required ADR own that decision.

## Decisions

- Catalog data is declarative; executable adaptation stays owner-bundled code.
- The installer-neutral exact applied-substitution record, never
  installed-name coincidence or terminal text, is the planning authority;
  npm-client is its sole v0 producer, not part of its value shape.
- Asset-set and dependency-tree identities remain independent.
