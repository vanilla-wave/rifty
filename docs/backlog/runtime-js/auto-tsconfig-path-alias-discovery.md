---
area: runtime-js
status: shipped
title: Automatic tsconfig discovery for path aliases (vs explicit paths option)
created: 2026-06-08
why: ADR-0066 shipped explicit caller-supplied paths; ADR-0170 adds zero-wiring auto-discovery when opted in
user_story: As a dev opening a TS project in rifty, I want `@/utils` style path aliases to resolve straight from my `tsconfig.json` (with `extends` chain and `baseUrl`) without hand-copying a `paths` map.
sources: [ADR-0066]
---
## Context

Landed 2026-06-22 via ADR-0170: `ModuleLoaderOptions.autoDiscoverTsconfigPaths`
uses the real TypeScript config parser over the VFS to locate nearest
`tsconfig.json`, follow `extends`, honor JSONC, `baseUrl`, and `paths`, and feed
the existing resolver with absolute alias targets. Explicit `paths` still win;
default remains Node-faithful.

ADR-0066 added tsconfig-style path aliases via an explicit `paths` option on `ModuleLoaderOptions`; resolver does pure pattern matching and callers may still supply the resolved map. ADR-0170 adds the opt-in automatic path: locate `tsconfig.json`, follow `extends`, interpret `baseUrl`, apply `paths`, and fall back through `baseUrl` for bare specifiers when no `paths` pattern matches.
## Options / Next
Shipped: explicit `paths` remains supported; `autoDiscoverTsconfigPaths` adds zero-wiring discovery when enabled. Default-off behavior remains Node-faithful.
## Reversibility
Reversible-additive over ADR-0066; recorded by ADR-0170.
