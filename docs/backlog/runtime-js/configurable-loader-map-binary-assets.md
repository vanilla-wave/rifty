---
area: runtime-js
status: parked
title: Configurable loader map + binary (.wasm) asset loader (vs fixed text-extension set)
created: 2026-06-08
why: ADR-0067 ships a fixed text-extension loader set; configurability + binary loader need real requirements
user_story: As a dev who wants to `import` a `.wasm` binary or wire a custom ext->loader map like esbuild's `loader`, I want that; currently only the fixed text set (`.txt`/`.sql`/`.md`/`.prompt`) is served and there is no binary loader or configurable map.
sources: [ADR-0067]
---
## Context
ADR-0067 added text-asset imports for a FIXED extension set (`.txt`/`.sql`/`.md`/`.prompt` -> default export = file contents; `TEXT_EXTENSIONS` in `module-loader/resolver.ts`). Two follow-ons deferred: (a) make the loader map CONFIGURABLE via `ModuleLoaderOptions` (per-project ext->loader map, like esbuild's `loader`); (b) a BINARY asset loader for `.wasm` (+ similar) a text loader can't serve. Deferral recorded in ADR-0067 Reversibility (no TODO(backlog) marker).
## Options / Next
Chosen (provisional): A — fixed set; B (configurable map + binary loader) deferred until a concrete need (a non-listed text ext, or `.wasm` import landing on a live path). B is additive over A but needs real requirements to design — esp. the binary representation (URL? bytes? `WebAssembly.Module`?). opencode's single tree-sitter `.wasm` is off the boot path; if it walls, it gets its own decision.
## Reversibility
Reversible — additive over A. Gate: a verified need (non-listed text ext or live `.wasm` import). Binary-representation choice is the design unknown to resolve when triggered.
