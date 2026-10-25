---
area: runtime-js
status: draft
title: node:vm explicit disposeContext seam has no production owner
created: 2026-06-14
why: one real seam from the ADR-0142 vm work is implemented + typed but has no production caller — tracked so it is not mistaken for live wiring nor rots into unexplained dead code
user_story: As a host embedding rifty in the browser, I want deterministic vm-context teardown for the M11 sandbox contract, but today `VmEngine.disposeContext` has no caller and production teardown is GC-only.
sources: [M11, ADR-0142, process-meta/consumer-ready-followup-cutline]
code:
  [
    packages/runtime-js/src/builtins/vm/types.ts,
    packages/runtime-js/src/builtins/vm/quickjs-engine.ts,
  ]
---
## Context
ADR-0142 shipped one seam the default path does not exercise:

- `VmEngine.disposeContext` (both engines implement it; quickjs does
  `guestRuntimes.delete` + `contextRegistry.unregister` + `lifetime.markPending`): no
  dispatcher/public path calls it. Production teardown is GC-only (the ContextObject
  finalizer marks the lifetime controller pending), matching Node (no vm-context
  teardown). The explicit seam is reserved for the M11 embeddable sandbox contract
  (create → write/read → exec → teardown).

## Options or Next
- Expose explicit `disposeContext` through the RuntimeController/Sandbox teardown
  when the embeddable SDK contract lands.
- Until then: keep it tracked here. Do NOT delete (forward-looking infra); do NOT
  present as live wiring.

## Reversibility
REVERSIBLE — the seam is internal; no public API change. The SDK teardown shape
is the provisional call this parks. QuickJS asset wiring shipped under ADR-0352.
