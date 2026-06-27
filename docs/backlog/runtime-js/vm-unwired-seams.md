---
area: runtime-js
status: draft
title: node:vm defined-but-unwired seams — wasm-URL env-config + explicit disposeContext
created: 2026-06-14
why: two real seams from the ADR-0142 vm work are implemented + typed but have no production caller — tracked so they are not mistaken for live wiring nor rot into unexplained dead code
user_story: As a host embedding rifty in the browser, I want the QuickJS `.wasm` served from my own env-configured URL and a deterministic vm-context teardown for the M11 sandbox contract, but today the bundled release-sync variant self-resolves its wasm (so `getQuickjsWasmUrl` is unused) and vm-context disposal is GC-only (so `VmEngine.disposeContext` has no caller).
sources: [M11, ADR-0142, process-meta/consumer-ready-followup-cutline]
code:
  [
    packages/runtime-js/src/builtins/vm/quickjs-loader.ts,
    packages/runtime-js/src/builtins/vm/types.ts,
    packages/runtime-js/src/builtins/vm/quickjs-engine.ts,
  ]
---
## Context
ADR-0142 shipped two seams the default path does not exercise:

- `getQuickjsWasmUrl()` (D-004 env-config of the `.wasm` URL): the bundled
  `@jitl/quickjs-wasmfile-release-sync` variant self-resolves its wasm from
  `node_modules`, so `ensureVmEngineReady()` loads via the variant and never threads
  the URL. The resolver + its precedence/default are unit-tested but have no
  production caller — they exist for a future browser/worker variant loader.
- `VmEngine.disposeContext` (both engines implement it; quickjs does
  `guestRuntimes.delete` + `contextRegistry.unregister` + `lifetime.markPending`): no
  dispatcher/public path calls it. Production teardown is GC-only (the ContextObject
  finalizer marks the lifetime controller pending), matching Node (no vm-context
  teardown). The explicit seam is reserved for the M11 embeddable sandbox contract
  (create → write/read → exec → teardown).

## Options or Next
- Wire `getQuickjsWasmUrl()` into a browser/worker variant loader (the release-sync
  variant has no URL-override hook → needs the wasmfile/asyncify variant or an
  emscripten `locateFile`).
- Expose explicit `disposeContext` through the RuntimeController/Sandbox teardown
  when the embeddable SDK contract lands.
- Until then: keep both, tracked here. Do NOT delete (forward-looking infra); do NOT
  present as live wiring.

## Reversibility
REVERSIBLE — both seams are internal; no public API change. The wiring decisions
(variant choice, SDK teardown shape) are the provisional calls this parks.
