---
area: distribution
status: active
title: EPIC B follow-ons — createSandbox facade cannot hide bundler-specific bits
created: 2026-06-08
why: B1-B3 shipped (ADR-0071); the honest limit is that createSandbox can't hide worker URLs / sw.js build / WASM asset serving — those leak to the consumer
sources: [ADR-0071, DD-1, DD-2, EPIC B, docs/backlog-distribution-and-ide.md]
---
## Context
Umbrella `@riftydev/sdk` is the front door (one `npm i` → all parts). EPIC B landed (ADR-0071): B1 subpath re-exports (`@riftydev/sdk/{vfs,runtime,net,…}`), B2 `createSandbox(options, deps?)` framework-free boot facade (probe capabilities → opt. assert COI → bring up VFS OPFS/memory → opt. register preview SW → spawnRuntime), B3 `checkCapabilities()` wrapping `detectCapabilities`.
Honest limit (B2): the facade CANNOT hide bundler-specific bits — worker URLs, `sw.js` build, WASM asset serving. Consumer still passes worker/SW URLs; those host-wiring bits land in EPIC E (create-rifty template), not in any library.

## Options / Next
- Open follow-on work on the umbrella beyond the landed B1-B3. Concrete:
  - Document the bundler-bit boundary in the SDK README (what createSandbox does/doesn't wire) so consumers know what they still own.
  - Keep the un-hideable host config (COOP/COEP, module-worker config, sw.js build, WASM copy, worker URLs) routed to EPIC E template — do NOT try to inline it into the SDK.
- DD-1 invariant holds: never inline `@riftydev/*` into each other — io (builtin registry) / kernel (globalProcessManager) / vfs (syncMirror) hold cross-package singletons; bundling duplicates state + silently breaks composition. tsup keeps them `external` + lockstep-pinned (ADR-0070 D4).
- DD-2: umbrella name is `@riftydev/sdk` (npm 403'd unscoped `rifty`); ratified ADR-0071.

## Reversibility
Mostly reversible (docs + boundary clarification). The DD-1 external-not-inlined rule and DD-2 name are already ratified in ADR-0071 — overturning either needs a decision subagent + superseding ADR. Any NEW createSandbox public-API surface = IRREVERSIBLE (cross-package API), needs its own ADR.
