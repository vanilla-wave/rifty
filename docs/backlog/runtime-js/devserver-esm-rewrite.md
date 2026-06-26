---
area: runtime-js
status: shipped
title: Dev-server ESM rewriting for bare specifiers (+ esbuild TS/JSX transform)
created: 2026-06-08
why: the example dev-server now rewrites ESM specifiers and runs the real esbuild.wasm TS/JSX transform so browser-served module graphs resolve
user_story: As a developer serving a Vite-like app from rifty, `import x from 'pkg'` plus `.ts`/`.tsx` modules load in the browser through served URLs and real TS/JSX transform.
sources: [compat/m10-tooling.md]
---
## Context

Landed 2026-06-22: `examples/vite-like-dev` transforms `.ts`/`.tsx`/`.jsx`
requests through the real vendored esbuild WASI binding, parses served modules,
resolves bare specifiers with the runtime resolver over the VFS, and rewrites
them to served URLs. Integration tests cover TS transform and node_modules bare
rewrite.

This shipped item is retained as the delivery record. The dev-server request path
parses served JS/TS, resolves bare specifiers and extensionless TS imports through
the runtime resolver, preserves query/hash suffixes, rewrites to served URLs, and
routes `.ts`/`.tsx`/`.jsx` through the vendored esbuild WASI transform.

## Verification

`tests/integration/vite-like-dev.test.ts` covers TS transform, bare
`node_modules` rewrite, extensionless relative TS imports, query/hash suffix
preservation, and tsconfig `paths`/`baseUrl` rewrite through the dev-server glue.
## Reversibility
REVERSIBLE — sits in `examples/` dev-server, additive (reuses the existing
resolver + vendored esbuild WASI hook through example dependencies), no
cross-package API.
