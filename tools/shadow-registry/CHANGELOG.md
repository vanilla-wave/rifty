# Changelog — @riftydev/shadow-registry

## [Unreleased]

### Changed

- The builtin catalog now carries exact `sass-embedded@1.100.0` as an
  install-only facade over registry-acquired `sass@1.100.0`; direct CJS/ESM
  compile, initialized compiler lifecycle, importers, logging, errors, and Vite
  7 SCSS are pinned against Node, while direct construction, initialized
  compiler internal reflection, CLI/watch/types, and the async-importer
  deadlock remain explicit gaps (ADR-0344).
- Snapshot drift validation derives Vite package bytes through Workbench's
  final manifest normalizer, matching the bake authority byte-for-byte
  (ADR-0336).
- Builtin substitution recipes now use strict clone-safe schema 2: recipe data
  owns admission features, exact registry dependency projections, and
  user-visible bin maps; one deeply freezing codec admits the generated
  catalog before internal export (ADR-0328).
- Install-artifact identity now hashes only behavior-bearing policy fields
  (`schema`/`api`/`version`/`consumer`/`source`/`wasm`/`patches`); compat prose
  edits no longer invalidate deployed stamps or force snapshot rebakes. One-time
  identity flip; the accompanying rebake changed no package bytes or versions.
- Cold offline promise reworded to the page-observable failure
  (`ShadowAssetError: failed to acquire …`); `ESHADOWASSET`/`acquire` fields
  stay unit-pinned below the owner boundary.

- Builtin substitutions now come from one generated, strict-decoded catalog
  with canonical catalog/recipe/file identities. Esbuild is an exact synthetic
  recipe with a runtime-asset binding; the retained lightningcss public tables
  derive byte-for-byte from its install-only recipe.
- The retired esbuild baked redirect and `@esbuild/wasi-preview1` alias shim are
  removed from the public root tables. Shared catalog primitives live only at
  the declared `./internal` subpath.
- The parallel vendored WASIp1 carrier is retired: no checked-in esbuild blob,
  fetch script, transform wrapper, `./esbuild-binding`, or published
  `./esbuild-transform` export remains. Registry-acquired `esbuild-wasm` is the
  sole product runtime.
- Baked dependency snapshot ids are SHA-256 of the exact uncompressed
  serialized bytes; the drift gate rejects missing, malformed, or stale ids.
- Install-artifact identity now includes the exact Vite CLI patch policy, and
  snapshot drift checks prove every baked Vite CLI is patchable before accepting
  generated metadata.
- Alias shims declare the exact public API version they materialize, allowing
  npm-client to reject incompatible source ranges before applying a baked
  substitution.
- The generated compatibility matrix classifies every loud D4 esbuild API gap
  as unsupported (`❌`), matching its named `NotImplementedError`.
- Snapshot drift checking is read-only. Legacy metadata or current contract
  drift requires `pnpm snapshots:bake`; the former relabeling migrator is
  deleted.

- **Shim data restructured for install-time application (ADR-0188).** New `internalsShims`
  table keyed by the INSTALLED trigger package with package-relative file paths, a proven
  `range`, alias `into` (lightningcss import name), and `companions` (rollup →
  `@rollup/wasm-node`, same-version lockstep). Replaces the `/workspace`-path-keyed
  `browserShimFileSets`/`viteBrowserShimFiles`/`viteBuildShimFiles` exports (removed; the
  npm-client installer is now the only applier). The rollup dev empty-Program stub is deleted —
  ONE mode-independent `dist/native.js` always delegates to the real `@rollup/wasm-node` parser.

### Added

- A deterministic install-artifact identity hashes exact baked overrides,
  internals-shim bytes, esbuild policy, and generated-runtime output identity;
  the PR gate rejects a stale generated identity (ADR-0241).
- A machine-readable esbuild 0.28.0 derivation policy and exact-text patch
  engine pin all twelve ADR-0226/0242 mutation sites. Missing, duplicate, overlapping,
  or reordered anchors fail before generation; the audit records input/output
  spans and SHA-256 digests.
- **esbuild 0.28.0 Vite Contract+RED (ADR-0226).** Row-addressable live oracle
  pins module/plugin identity, transform/diagnostics, config graph, dependency scan,
  default-write prebundle, and write failure before the VFS runtime implementation;
  exact upstream browser-client and Go-WASM SHA-256 pins stop source drift.
- `bakedOverrides` now redirects `lightningcss` to `lightningcss-wasm@1.32.0`,
  and exports a `lightningcssShimFiles` overlay that preserves the package name
  while delegating both ESM and CJS entrypoints to the real WASM implementation.
