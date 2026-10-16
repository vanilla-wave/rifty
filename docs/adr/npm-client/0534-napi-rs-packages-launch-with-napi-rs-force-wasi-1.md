# ADR 0534: napi-rs packages launch with NAPI_RS_FORCE_WASI=1

Status: Accepted
Date: 2026-10

> TL;DR: Records the existing launch preparation: dev-server children and `.bin/vite` spawns get `NAPI_RS_FORCE_WASI=1`, the public napi-rs selector for a package's published WASI binding; a declared `substitution-environment` adaptation whose loud anchor is the loader's own failure, removable once the admitted loaders are shown to need it nowhere.

## Context

The key has been set since Vite 8 support (`launch.ts`
`preparePackageServerEnvironment`, `vite-cli-prep.ts`
`prepareViteBinSpawnRequest`) with no deciding record; ADR-0336 uses it only
as its real-Node probe protocol. Inventory sweep 2026-10-16 (goal
`honest-guest-package-adaptations` I3, scenario 3):
`docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md`.
Rolldown 1.0.3 (`dist/shared/binding-*.mjs`, the loader napi-rs generates)
tries native bindings, then `if (!nativeBinding || process.env.NAPI_RS_FORCE_WASI)`
loads `@rolldown/binding-wasm32-wasi`; only with the key is a WASI load error
kept in `loadErrors`, which become the cause chain of the loader's
`Cannot find native binding` throw.

## Decision

1. Keep the key in those two launches, as a declared adaptation: class
   `substitution-environment` (selects upstream's published WASI twin
   binding; native addons are out of scope). Guest-visible: `process.env`
   carries a key real Node does not set.
2. Loud anchor: a napi-rs loader that cannot load its WASI binding throws with
   the WASI error in its cause chain; a selector napi-rs stops honoring leaves
   the native-then-WASI fallback, which the Vite 8 lanes exercise.
3. Kill condition: the Vite 8 build/dev/preview lanes and a napi-rs-loaded
   package pass without the key (`npm-client/napi-rs-force-wasi-launch-env`);
   then remove it.

## Consequences

- (+) The adaptation is declared with class, authority, anchor and kill.
- (−) Guest programs see `NAPI_RS_FORCE_WASI=1` until the removal proof lands.
