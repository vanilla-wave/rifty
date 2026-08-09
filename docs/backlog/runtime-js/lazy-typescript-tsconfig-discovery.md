---
area: runtime-js
status: draft
title: Lazy-load TypeScript for tsconfig path discovery
created: 2026-06-26
why: two static TypeScript imports pull the compiler into runtime-js bundles even when tsconfig discovery and TypeScript eval are unused.
user_story: As a browser runtime user running plain JavaScript without tsconfig discovery, I want to avoid loading the TypeScript compiler, but today two core module-loader consumers import it eagerly.
sources: [PR76 review C3, ADR-0170]
code: [packages/runtime-js/src/module-loader/tsconfig-paths.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

`tsconfig-paths.ts` statically imports `typescript` for opt-in tsconfig parsing.
`loader.ts` independently imports it to distinguish TypeScript-only CLI eval
source before raising the named TypeScript gap. Both modules sit on the
runtime-js core path, so plain JavaScript can pull the compiler into bundles
even when `autoDiscoverTsconfigPaths` is false and no eval source needs
TypeScript.

## Options or Next

One backlog item and TODO owns both imports; removing only the
`tsconfig-paths.ts` import does not close it. Preserve explicit `paths` without
TypeScript and add bundle/loader proof that default-off tsconfig discovery plus
JavaScript-only eval do not load the compiler.

Before readiness, settle the synchronous eval fork: either prepare one shared
lazy compiler before the synchronous eval API is exposed, or replace
`loader.ts`'s compiler-backed gap classifier with an exact smaller synchronous
classifier. A direct dynamic import inside synchronous eval cannot preserve the
current API/error timing. The existing
`TODO(backlog: runtime-js/lazy-typescript-tsconfig-discovery)` remains the
single marker; its completion sweep covers both static consumers.

## Reversibility

REVERSIBLE — internal loading strategy change, recorded here.
