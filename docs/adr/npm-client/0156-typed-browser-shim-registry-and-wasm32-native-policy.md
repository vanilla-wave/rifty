# ADR 0156: Typed browser shim registry and wasm32 native policy

Status: Accepted
Date: 2026-06

> TL;DR: Vite-class browser shims are declared through a typed registry, and
> `cpu:["wasm32"]` is accepted as a WASI/WebAssembly target.

## Context

Vite 8 adds two npm-shape requirements over the Vite 5 path:

- LightningCSS imports the native `lightningcss` package name, but a browser
  realm must use `lightningcss-wasm`.
- Rolldown's WASI binding uses `cpu:["wasm32"]`; ADR-0051 admitted only
  `cpu:["wasm"]`, which would falsely reject a WebAssembly target.

ADR-0027 said the third per-file shim site must promote the ad-hoc overlay list
to a typed registry. LightningCSS is that third site after esbuild and Rollup.

## Decision

- `@riftydev/shadow-registry` owns `browserShimFileSets`,
  `collectBrowserShimFiles`, and `viteBrowserShimFiles`.
- Playground and live smoke consume the named Vite shim set instead of spelling
  out each package overlay at the call site.
- `@riftydev/npm-client` treats `wasm32` like `wasm` for the CPU gate: required
  WASI/WebAssembly packages install, native platform packages still throw/skip
  per ADR-0051.

## Consequences

- ADR-0027's three-site promotion trigger is satisfied without moving shim
  source into npm-client's install layer.
- ADR-0051's native policy now says "WebAssembly targets (`wasm`, `wasm32`)",
  not only `wasm`.
- Full-package substitutions remain in `bakedOverrides`; per-file browser
  overlays remain post-install and ordered before module loading.
