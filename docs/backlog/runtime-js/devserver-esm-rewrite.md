---
area: runtime-js
status: parked
title: Dev-server ESM rewriting for bare specifiers (+ esbuild TS/JSX transform)
created: 2026-06-08
why: bare-specifier rewrite + esbuild.wasm TS/JSX transform are both unimplemented in the example dev-server — compat rows ❌ Pending
user_story: As a developer serving a Vite-like app from rifty, want `import x from 'pkg'` plus `.ts`/`.tsx` modules to load in the browser — but the dev-server neither rewrites bare specifiers to served URLs nor runs the esbuild.wasm TS/JSX transform, so the npm module graph won't resolve.
sources: [compat/m10-tooling.md]
---
## Context
The `examples/vite-like-dev` dev-server serves HTML+JS from the VFS and runs fs.watch-driven HMR (both ✅), but does NOT rewrite bare ESM specifiers (`import x from 'pkg'` -> a resolvable URL) the way Vite does, and does NOT transform TS/JSX via esbuild.wasm. docs/backlog/ rows (dissolved from the m10-tooling matrix): "Dev-server — ESM rewriting for bare specifiers" ❌ Pending; "Dev-server — TS/JSX transformation via esbuild.wasm" ❌ Pending (esbuild.wasm is now vendored per ADR-0047, so the transform dependency exists). Without bare-specifier rewrite a browser-served module graph can't resolve npm deps; this also gates "Real upstream Vite".
## Options / Next
Next: in the dev-server request path, parse served JS, resolve bare specifiers against the in-VFS node_modules (reuse the runtime resolver), rewrite to served URLs; route `.ts`/`.tsx`/`.jsx` through the vendored esbuild.wasm `transformSource` hook before serving. Flip both compat rows to ✅ when landed; together they unblock the "Real upstream Vite" row.
## Reversibility
Parked — sits in `examples/` dev-server, additive (reuses the existing resolver + the already-vendored esbuild WASI hook), no cross-package API, no new dep. Scope is a larger feature (full bare-specifier graph rewrite), so deferred rather than near-term.
