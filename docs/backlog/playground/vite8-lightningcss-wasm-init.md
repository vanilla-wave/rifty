---
area: playground
status: draft
title: vite8 — lightningcss-wasm shim never calls init() (css.transformer:'lightningcss' throws low-level wasm error)
created: 2026-06-21
why: The `lightningcss → lightningcss-wasm` shim's `default` export is the MODULE NAMESPACE and it re-exports `transform`/`bundle` directly — but lightningcss-wasm requires an async `init()` first (its default export IS `init`; `transform` throws on uninitialised wasm). So opting into `css.transformer:'lightningcss'` surfaces a confusing low-level wasm error, not working CSS nor a clean NotImplementedError. (Default CSS = PostCSS, so the shipped presets don't hit it — but the opt-in path is broken/dishonest.)
user_story: As a dev who sets `css.transformer:'lightningcss'` in vite.config, I want CSS transformed by lightningcss-wasm (or a clear loud gap), but today the shim never initialises the wasm and throws an opaque error.
sources: [tools/shadow-registry/src/index.ts]
code: [tools/shadow-registry/src/index.ts]
---

## Context

`SHIM_LIGHTNINGCSS_ESM` sets `export default lightningcss` = `import * as lightningcss`
(namespace, non-callable) and re-exports named `transform`/`bundle`/etc from
lightningcss-wasm WITHOUT awaiting `init()`. Native lightningcss `transform` is a
sync NAPI call with no init; the WASM port is not. The shim never bridges the gap.

## Options or Next

Wire `init()` (instantiate the wasm, reading the `.wasm` from the VFS) before
`transform`/`bundle`, exposing a Node-shaped sync surface if feasible; OR if a
sync init isn't possible in the dev pipeline, loud-throw a clear
`NotImplementedError('css.transformer:lightningcss', …)` instead of a low-level
wasm error. Add a `css.transformer:'lightningcss'` test. Acceptance: opt-in
lightningcss either transforms CSS or loud-throws — never a confusing wasm error.

## Reversibility

REVERSIBLE — shim wiring; no public-API/ADR change.
