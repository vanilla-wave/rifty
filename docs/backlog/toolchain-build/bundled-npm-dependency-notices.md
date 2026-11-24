---
area: toolchain-build
status: draft
title: npm dependencies inlined into published bundles, and copied .wasm, ship without their license notices
created: 2026-11-24
why: bundlers inline ~50 npm packages into workbench `dist/assets` and 4 into the isolate guest; their LICENSE stays in the consumer's node_modules or nowhere, while MIT/ISC/BSD/Apache-2.0 require it with every copy
user_story: As a developer shipping `@riftydev/workbench` assets or `guest.js` in a product, I want the licenses of the code inside those files next to them, but today the files carry none
sources: [docs/backlog/toolchain-build/third-party-notices-in-published-files.md, docs/backlog/distribution/dependency-license-audit.md]
code: [tools/publishing/build-workbench-assets.mjs, packages/isolate-guest/scripts/build-guest.mjs]
---

## Context

Same legal class as `third-party-notices-in-published-files.md` (copied code
without its notice), split by the manager on 2026-11-24: there is no committed
artifact to fingerprint, so detection needs the build graph (esbuild metafile),
not packed-file content.

Measured 2026-11-24, main `841fa5300`, esbuild 0.28.0 metafile replaying
`tools/publishing/build-workbench-assets.mjs` and `build-guest.mjs`:

- workbench `dist/assets` (published since 0.1.0; list = today's build): 50 npm packages inlined —
  41 MIT, 3 Apache-2.0 (`typescript` 9.9 MB in `typescript-worker.js` with its
  short header only, `crc-32`, `clean-git-ref`), 2 ISC (`semver`, `inherits`), 1
  BSD-3-Clause (`ieee754`), `pako` (MIT AND Zlib), `sha.js` (MIT AND BSD-3-Clause).
  Largest: typescript, isomorphic-git 313 KB, acorn 223 KB, pako 129 KB,
  sql.js 75 KB, quickjs-emscripten-core 61 KB, buffer 57 KB, semver 46 KB.
- isolate-guest `dist/guest.js` (unpublished): acorn, cjs-module-lexer,
  quickjs-emscripten-core, @jitl/quickjs-ffi-types. isolate-host
  `child.js`/`codec.js`: none. tsup `dist/` of every package: none (sourcemap
  `sources`).
- Copied binaries in workbench `dist/assets`: `quickjs.wasm`
  (`@jitl/quickjs-wasmfile-release-sync`: QuickJS + quickjs-emscripten, MIT),
  `sql-wasm.wasm` (sql.js MIT, SQLite public domain, emscripten runtime) — a
  binary carries no comment.
- License files in node_modules for the 50: 71 585 B total; no license file in
  `diff3` (MIT), `isarray` (MIT), `clean-git-ref` (Apache-2.0) — the text has
  to come from elsewhere.
- Option seen: one generated notices file in `dist/assets` from the metafile
  (+ the two `.wasm`): not loaded by clients, so no client-bundle budget effect.
  Legal comments per chunk would grow eager bundles; not measured.

## Challenge

challenge: 2026-11-24 — clear — factual capture (README §Challenge: no premise critic)
