# ADR 0173: Vite 7 production build and preview

Status: Accepted
Date: 2026-06

> TL;DR: The default Vite template stays on Vite 7 for production build/preview:
> `vite build` runs Vite's real Node API in a supervised child with build-only
> real Rollup WASM + esbuild-WASI shims, and `vite preview` serves the built
> `dist/` through the existing cross-realm preview bridge. Vite 8 build/preview
> remains loud-rejected.

## Context

The playground goal is real Node programs in Chromium, not a Vite-like stub.
Before this decision, `vite build`/`vite preview` were deliberately rejected so
they could not exit 0 with no `dist/`.

Vite 7's production build is Rollup 4 + esbuild. The dev path's cheap Rollup
native shim is not faithful enough for build (`build-html` needs real AST
buffers), and esbuild's renderChunk minify path needs a real async transform and
the real JS API result shape (`map: ''` when sourcemaps are off/inline; real JSON
when external). Vite 8's Rolldown WASI build path is still upstream-blocked
(ADR-0162), so production build support must be scoped to the Vite 7 default.

## Decision

1. **Default template = Vite 7.** Keep `vite: ^7.0.0` and add
   `@rollup/wasm-node@4.62.2`. Bake-time lockstep asserts the resolved `rollup`
   version equals `@rollup/wasm-node`.
2. **Build-only shim set.** Add `viteBuildShimFiles`: Rollup's build
   `native.js` delegates to real `@rollup/wasm-node`; esbuild delegates async
   `transform()` to an injected rifty bridge backed by `@riftydev/runtime-wasi`
   and the vendored `esbuild.wasm`. Dev keeps the existing cheap dev shims.
3. **Run Vite's Node APIs.** `vite build` and `vite preview` spawn the same
   supervised child shape as the dev server, over remote owner FS. Build calls
   `await build({ configFile:false, base:'./', build:{ outDir:'dist' } })`;
   preview calls real `preview()` on port 4173 after asserting `dist/index.html`
   references built assets.
4. **Preview is a first-class source.** The preview registry gains
   `source:'preview'`; the page wires non-dev-server ports and auto-selects a
   newly added production preview. Fetch and iframe both go through
   `/preview/4173/`.
5. **Vite 8 stays honest.** `vite8` remains opt-in for dev boot and still
   loud-rejects `build`/`preview`; `vite optimize` stays rejected.

## Consequences

- (+) User-visible `vite build` writes a real hashed, minified `dist/`; `vite
  preview` serves that bundle, not the dev server.
- (+) Fidelity holds: no fake Rollup AST, no fabricated sourcemap, no partial
  exit-0 dist. Missing/unsupported surfaces throw directed errors.
- (+) Dev boot stays fast because the real Rollup WASM parser is only overlaid
  on the build path.
- (-) Adds a new template dependency and a version-coupled Rollup parser; the
  bake guard must fail loudly on drift.
- (-) Browser build workers need a browser-safe esbuild transform module and
  fetch the vendored wasm as a Vite asset; Node-only wasm loading stays in the
  test/tool wrapper.
- Verification: `tests/e2e/vite7-build-preview.spec.ts` proves build, hashed
  HTML, preview fetch, and built iframe render; integration tests cover esbuild
  minify/external-map/API-shape behavior.
