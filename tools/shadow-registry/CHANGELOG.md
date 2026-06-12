# Changelog — @riftydev/shadow-registry

## [Unreleased]

### Added

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
