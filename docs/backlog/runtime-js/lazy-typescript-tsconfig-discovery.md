---
area: runtime-js
status: active
title: Lazy-load TypeScript for tsconfig path discovery
created: 2026-06-26
why: static TypeScript import pulls the compiler into runtime-js bundles even when autoDiscoverTsconfigPaths is off.
user_story: As a browser runtime user not using tsconfig auto-discovery, I want the runtime-js bundle to avoid loading the TypeScript compiler, but today the module-loader imports it on the core path.
sources: [PR76 review C3, ADR-0170]
code: [packages/runtime-js/src/module-loader/tsconfig-paths.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

`tsconfig-paths.ts` statically imports `typescript`. The loader/resolver chain is part of the runtime-js core path, so the compiler can be pulled into bundles even when `autoDiscoverTsconfigPaths` is disabled.

## Options or Next

Move the TypeScript dependency behind a dynamic import used only by tsconfig auto-discovery. Preserve explicit `paths` behavior without importing TypeScript, and add bundle/loader coverage that the default-off path does not load the compiler.

## Reversibility

REVERSIBLE — internal loading strategy change, recorded here.
