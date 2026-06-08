---
area: runtime-js
status: parked
title: Configurable loader map + binary (.wasm) asset loader (vs fixed text-extension set)
created: 2026-06-08
why: ADR-0067 ships a fixed text-extension loader set; configurability + binary loader need real requirements
sources: [ADR-0067]
---
## Context
ADR-0067 added text-asset imports for a FIXED extension set (`.txt`/`.sql`/`.md`/`.prompt` -> default export = file contents; `TEXT_EXTENSIONS` in `module-loader/resolver.ts`). Two follow-ons deferred: (a) make the loader map CONFIGURABLE via `ModuleLoaderOptions` (per-project ext->loader map, like esbuild's `loader`); (b) a BINARY asset loader for `.wasm` (+ similar) a text loader can't serve. Deferral recorded in ADR-0067 Reversibility (no TODO(backlog) marker).
## Options / Next
Chosen (provisional): A — fixed set; B (configurable map + binary loader) deferred until a concrete need (a non-listed text ext, or `.wasm` import landing on a live path). B is additive over A but needs real requirements to design — esp. the binary representation (URL? bytes? `WebAssembly.Module`?). opencode's single tree-sitter `.wasm` is off the boot path; if it walls, it gets its own decision.
## Reversibility
Reversible — additive over A. Gate: a verified need (non-listed text ext or live `.wasm` import). Binary-representation choice is the design unknown to resolve when triggered.
