---
area: runtime-js
status: active
title: Loader-internal TS-strip transform cache — key + invalidation
created: 2026-06-08
why: id-keyed cache shipped; content-hash keying deferred until a live in-place HMR edit layer exists
user_story: As a developer live-editing a `.ts` file in place under an HMR layer, I want re-import to pick up my edit, but today the strip cache keys by resolved id (not content) so a mutated source serves the stale transform until explicit `invalidate(id)`
sources: [ADR-0052 D4]
code: [packages/runtime-js/src/module-loader/loader.ts:81]
---
## Context
`loader.ts` wraps `opts.transformSource` in a `Map<id,string>` (`transformCache`) so the WASI esbuild strip isn't re-spawned per `.ts` across the opencode graph / repeated loads. Cleared via the existing `invalidate(id)` -> `registry.invalidate` path. TODO(backlog: runtime-js/ts-strip-transform-cache) markers at loader.ts:81 (cache decl) and :187 (invalidate coupling). `esm.ts` stays cache-unaware.
## Options / Next
Chosen (provisional): A — key by absolute resolved id (installed sources immutable per pkg version in VFS overlay); drop via existing `invalidate(id)`, full `invalidate()` clears all. Alt: B content-hash key — correct under live in-place edits without explicit invalidate, but unnecessary in P0 (sources don't mutate) and adds a per-load hash on the hot path. Promote A (or switch to B) when a live in-place HMR edit layer lands.
## Reversibility
Reversible (<20 lines, 1 file) — internal to `createModuleLoader`, no new export, no signature change, no dep. Plain-JS loaders unaffected.
