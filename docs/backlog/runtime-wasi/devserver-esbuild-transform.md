---
area: runtime-wasi
status: shipped
title: examples/vite-like-dev — TS/JSX transform + bare-specifier ESM rewriting via esbuild.wasm
created: 2026-06-08
why: shipped — the mini dev-server now serves TS/TSX/JSX through real esbuild.wasm and rewrites bare ESM specifiers to VFS URLs
user_story: As a dev running the bundled `vite-like-dev` example, I want `.ts`/`.tsx`/`.jsx` requests and bare `import` specifiers to behave like a real browser dev-server path; the example now runs the existing WASI esbuild transform and ESM rewrite pipeline
sources: [TASKS M10]
---
## Context

Landed 2026-06-22: the mini dev-server now calls the real
`transformWithEsbuild()` / `runWasi` pipeline for TS/TSX/JSX and rewrites bare
ESM specifiers to VFS-served URLs; the runtime-js companion item owns the server
request-path details.

The example remains intentionally small, but its transform path is no longer a
stub or a documented gap: `.ts`, `.tsx`, and `.jsx` requests go through the same
WASI esbuild binding used by the shadow-registry tooling, and bare package
imports are rewritten to concrete VFS-served module URLs.
## Reversibility
Reversible — example-local wiring over existing esbuild-binding + AST-rewriter
primitives, no new public API / dep / ADR contradiction.
