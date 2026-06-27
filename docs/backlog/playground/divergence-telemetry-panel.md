---
area: playground
status: draft
title: dev-only playground divergence/NotImplemented telemetry panel (sorted hit counts)
created: 2026-06-14
why: telemetry channel is built (sink + boundary capture + loud stderr warning + host diagnostic event) but the playground guest path never reaches a page-side listener, so a panel today would be a silent-stub empty box
user_story: As a playground developer, I want a panel showing sorted divergence/NotImplemented hit counts (`snapshotTelemetry()` output) for my session, but today the guest runs via the kernel/shell path so the worker's `diagnostic` postMessage has no page listener and any panel would always be empty.
sources: [M11, ADR-0142, playground/notimplemented-stub-telemetry]
code:
  [
    apps/playground/src/glue/realVite.ts,
    packages/runtime-js/src/host.ts,
    packages/runtime-js/src/worker-entry.ts,
    packages/runtime-js/src/telemetry/divergence-sink.ts,
  ]
---
## Context
Telemetry channel exists end-to-end on the runtime-js side: sink (`telemetry/divergence-sink.ts`), worker boundary capture (`captureNotImplemented`), one loud `vm.engine.rewrite-active` stderr warning (visible in the playground terminal), and a host `diagnostic` RuntimeEvent for `spawnRuntime`/`createSandbox` consumers. But the playground runs guest JS via the kernel/shell path (`apps/playground/src/glue/realVite.ts` → `globalProcessManager.spawnWorker`, stdio-based), NOT via runtime-js `RuntimeController` — so the worker's `diagnostic` postMessage has no page-side listener. A panel subscribing to a freshly-spawned `spawnRuntime` controller would always be empty (a silent stub — repo rules forbid). Sibling: `playground/notimplemented-stub-telemetry` (the playground-surface counterpart).

## Options or Next
- (A) Route the worker `diagnostic` telemetry to the page over the existing kernel worker→page IPC/stdio channel + a playground host adapter + a solid signal. Honest; adds a kernel IPC frame type — layering-sensitive.
- (B) Playground adopts `spawnRuntime`/`createSandbox` as the guest-JS execution path. Largest change; replaces the current shell/kernel model.
- (C) DONE — the telemetry data types (`TelemetryEntry`/`TelemetryKind`/`TelemetrySnapshot`) are now exported from the runtime-js public index (this PR), so an SDK consumer can type the `diagnostic` payload without a deep import.

GATE: only worth doing if a dev actually needs the aggregated panel beyond the already-visible terminal warning.

## Reversibility
REVERSIBLE — dev-only instrumentation, no public API beyond the already-exported data types (C). Capture-routing fork (A vs B) is the provisional call this item parks.
