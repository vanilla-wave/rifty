# Changelog — @riftydev/shadow-registry

## [Unreleased]

### Changed

- Baked dependency snapshot ids are SHA-256 of the exact uncompressed
  serialized bytes; the drift gate rejects missing, malformed, or stale ids.
- Install-artifact identity now includes the exact Vite CLI patch policy, and
  snapshot drift checks prove every baked Vite CLI is patchable before accepting
  generated metadata.
- Alias shims declare the exact public API version they materialize, allowing
  npm-client to reject incompatible source ranges before applying a baked
  substitution.
- Final esbuild shape replaces the interim bridge/dual-entry facade with one
  install-time CJS overlay backed by the exact Worker runtime slot
  (ADR-0226/0242).
- Snapshot drift checking is read-only. Legacy metadata or current contract
  drift requires `pnpm snapshots:bake`; the former relabeling migrator is
  deleted.

- **Shim data restructured for install-time application (ADR-0188).** New `internalsShims`
  table keyed by the INSTALLED trigger package with package-relative file paths, a proven
  `range`, alias `into` (esbuild/lightningcss import names), and `companions` (rollup →
  `@rollup/wasm-node`, same-version lockstep). Replaces the `/workspace`-path-keyed
  `browserShimFileSets`/`viteBrowserShimFiles`/`viteBuildShimFiles` exports (removed; the
  npm-client installer is now the only applier). The rollup dev empty-Program stub is deleted —
  ONE mode-independent `dist/native.js` always delegates to the real `@rollup/wasm-node` parser.

- **esbuild shim: dual entry + every unbridgeable surface loud (ADR-0188 review).**
  `require('esbuild')` now works like real Node: the shim ships `lib/main.cjs` beside the ESM
  `lib/main.js` (one shared body; `exports.require → ./lib/main.cjs`) — the old require condition
  pointed into a `type:module` `.js`, which the rifty loader loud-fails on sync require. The fake
  happy paths are gone: `build()` refuses an entry whose transformed output still imports LOCAL
  files (`esbuild.build.bundle` — the bridge transforms one module; real esbuild would bundle);
  `context()` constructs only with EMPTY entry points (its empty `rebuild()` matches real
  esbuild's zero-entry result; entries refuse at construction, `serve()` refuses always);
  `analyzeMetafile*()` refuses non-empty metafiles instead of returning `''`. The alias
  metadata no longer lies about its version: package.json + the `version` export claim
  0.28.0 (the exact `bakedOverrides` trigger pin — was a stale static `0.21.5`), and the
  shim `range` is the same EXACT pin so a bumped override loud-throws at install until
  the static claims move with it (guard test pins the coupling).

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
- `viteBuildShimFiles` adds a production-build overlay: Rollup's native entry
  delegates to real `@rollup/wasm-node`, and esbuild's async `transform()` is
  bridged to real esbuild-WASI for minify/target/external-map build phases.
- New browser-safe `./esbuild-transform` subpath exposes `transformWithEsbuild`
  without Node builtins; `./esbuild-binding` remains the Node-side vendored-wasm
  loader for tests/tools.
- `bakedOverrides` now redirects `lightningcss` to `lightningcss-wasm@1.32.0`,
  and exports a `lightningcssShimFiles` overlay that preserves the package name
  while delegating both ESM and CJS entrypoints to the real WASM implementation.
- Added `browserShimFileSets`, `collectBrowserShimFiles`, and
  `viteBrowserShimFiles` (ADR-0156) so Vite-class overlays are selected by typed
  shim-set name instead of hand-spelling every package at each call site.
- `esbuildShimFiles` no longer exposes a silent pass-through `transform`. The
  overlaid `esbuild` package now delegates `transform()` to the playground's
  installed `globalThis.__riftyEsbuildTransform` bridge and loud-throws
  `NotImplementedError('esbuild.transform')` if the bridge is missing;
  `transformSync` also loud-throws because the real WASI transform is async.
- `transformWithEsbuild(..., { supported })` now forwards every
  `--supported:<feature>=<bool>` entry to the real esbuild-WASI CLI (including
  `decorators` and Vite 7's `dynamic-import` build flag).
- `bakedOverrides` now redirects `esbuild` to `@esbuild/wasi-preview1@0.28.0`,
  so Vite installs avoid the real package's native-binary `postinstall`; the
  playground still overlays `node_modules/esbuild` with the browser-safe shim.
- `transformWithEsbuild(..., { sourcemap: 'inline' })` now forwards
  `--sourcemap=inline`, keeping the default output unchanged while allowing
  loader stack-remap tests and parity cases to consume esbuild's map.
- **esbuild WASI shadow-binding (ADR-0047).** `src/esbuild-binding.ts` exposes
  `transformWithEsbuild(runWasi, wasm, opts)` — Vite's TS/JSX transform surface
  routed to the real esbuild WASI binary running through `@riftydev/runtime-wasi`'s
  `runWasi`. Source is fed over stdin with `--loader=<ts|tsx|jsx|js>`; output is
  the transformed JS. A non-zero guest exit throws with esbuild's stderr (no
  fake passthrough output, per the "no silent stubs" rule). `runWasi` is
  dependency-injected so this tool keeps no import edge to the WASI runtime.
  Also exports `loadVendoredEsbuildWasm()` and `ESBUILD_WASM_VENDOR_PATH`.
- **Build-time vendoring script** `scripts/fetch-esbuild-wasi.mjs`. Pulls
  `@esbuild/wasi-preview1@0.28.0` from the npm registry, verifies the tarball
  against a pinned SHA-512 integrity, extracts `esbuild.wasm`, and writes it to
  `vendor/esbuild-wasi-preview1/esbuild.wasm`. Zero non-builtin deps (node:https
  / node:crypto / node:zlib + a minimal ustar reader). The wasm is a checked-in
  build-time artifact, NOT a package dependency.
- New subpath export `./esbuild-binding`.

### Context

ADR-0047 reversed ADR-0044's swc substitution. swc has no WASI build (its
published wasm is wasm-bindgen); `@esbuild/wasi-preview1` is a genuine WASIp1
binary (imports only `wasi_snapshot_preview1`), distinct from the gojs
`esbuild-wasm`. The existing `esbuildShimFiles` passthrough overlay is retained
for the import-time `'esbuild'` resolution; this binding replaces the actual
*transform* with a real esbuild run.
