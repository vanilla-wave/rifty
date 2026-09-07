# ADR 0382: Preserve tsconfig discovery through explicit compiler preload

Status: Accepted
Date: 2026-09-07

## Context

The ADR-0380 caller sweep omitted `examples/`. `vite-like-dev` enables
`autoDiscoverTsconfigPaths` for served JS/TS imports, including aliases and
baseUrl fallback. Removing it makes 7/10 real integration tests return HTTP
500 (0 timeouts, reproduced in isolation); full workspace typecheck also fails.
This is an existing supported example, even though current playground source
no longer imports it. Independent DEC-2 review confirmed the missed authority.

## Decision

Supersede ADR-0380 D1 only; retain D2–4 and ADR-0381. Restore ADR-0170 discovery
semantics, errors and caches. Default-off and explicit `paths` priority remain.

Export `preloadTsconfigPaths(): Promise<void>` from `@riftydev/runtime-js/loader`.
It dynamically imports the real parser plus ADR-0381's browser-scoped compiler;
ESM owns loading/deduplication. Publish its module only after successful import.
No extra queue, lock or worker. Failure rejects with its original chunk cause.

A synchronous loader/resolver enabling discovery without explicit paths requires
preload first; otherwise throw `ModuleLoadError` code `TSCONFIG_NOT_READY` with
the preloader instruction. Explicit paths and default resolution do not require
or trigger loading. The example's existing async `startDevServer` preloads
before creating HTTP/WebSocket resources, preserving its request behavior.

## Alternatives

- Preload + existing sync factory: chosen; preserves synchronous require,
  resolver identity, discovery and cache contracts with one preparation API.
- Second async factory: larger creation surface; the old sync option would
  still need an explicit readiness rule.
- Example-only explicit paths: does not retain baseUrl fallback or inherited
  config policy without duplicating the same parser/resolver policy there.
- Delete example/scenario: rejected; fails the observed baseline, not authorized
  by the compiler-byte goal.

## Consequences

Restore all prior discovery conformance assertions, adding only preparation.
Keep example integration assertions unchanged. Add missing-preload and failed
chunk regressions; no default/explicit-path compiler fetch. The source and
packed boot compiler guards remain binding.
