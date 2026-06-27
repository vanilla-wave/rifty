---
area: playground
status: draft
title: vite8 — prune dead esbuild/rollup shim overlays (phantom node_modules, version-drift, lying pass-through)
created: 2026-06-21
why: `overlayShims()` unconditionally writes phantom `node_modules/esbuild` (pass-through transform that returns input UNCHANGED; package version 0.21.5 ≠ the install override `@esbuild/wasi-preview1@0.28.0`) and `node_modules/rollup/dist/native.js` (parse returns an EMPTY ESTree Program) on every Vite boot — but Vite 8 depends on NEITHER (it transforms via oxc, parses via `rolldown/parseAst`). Dead today, but a latent silent-lie: a user/plugin `import 'esbuild'`/`require('rollup')` resolves to the LYING shim instead of MODULE_NOT_FOUND, the version drifts, and the overlay also overwrites lightningcss AFTER the lockfile (on-disk bytes ≠ recorded integrity).
user_story: As a dev inspecting node_modules or importing esbuild/rollup in the Vite 8 sandbox, I want what a real `vite@8` install yields (neither package — or a loud gap), but today I get fabricated packages whose shims silently return untransformed code / an empty AST.
sources: [tools/shadow-registry/src/index.ts, apps/playground/src/glue/esbuild-shim.ts, apps/playground/src/workers/dev-server-boot.ts]
code: [tools/shadow-registry/src/index.ts]
---

## Context

`viteBrowserShimFiles = collectBrowserShimFiles(['esbuild','lightningcss','rollup'])`
is overlaid every boot. Of these, only `lightningcss` is a real Vite 8 dependency;
`esbuild`/`rollup` are Vite-5-era leftovers. `SHIM_ESBUILD_SOURCE.transform`
returns input unchanged + `context().rebuild` a fake empty success;
`ROLLUP_NATIVE_SHIM.parse` returns `{type:'Program',body:[]}`. `SHIM_ESBUILD_VERSION`
('0.21.5') disagrees with the install override ('@esbuild/wasi-preview1@0.28.0').

## Options or Next

Verify no current consumer (mini-dev, examples, the standalone esbuild WASI runner
per ADR-0047) needs the esbuild/rollup overlay on the Vite path FIRST. Then: trim
`viteBrowserShimFiles` to `lightningcss` only; and make a direct `import 'esbuild'`
/ `require('rollup')` a LOUD `NotImplementedError` (use the WASI runner) instead of
a lying pass-through; fix the esbuild version-drift; record the overlay-vs-lockfile
integrity gap. Acceptance: a real Vite 8 sandbox node_modules has no esbuild/rollup;
a direct import loud-throws, never silently lies.

## Reversibility

REVERSIBLE — overlay/shim data only. Gated on confirming other consumers (esbuild
WASI runner / mini-dev) don't rely on the overlay before removing it.
