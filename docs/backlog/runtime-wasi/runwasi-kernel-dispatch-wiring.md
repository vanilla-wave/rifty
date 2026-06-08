---
area: runtime-wasi
status: parked
title: runWasi → kernel ProcessHandle dispatch wiring (ADR-0038 left as TODO)
created: 2026-06-08
why: ADR-0038 bridges runWasi to kernel spawnWorker so big WASI tools don't block the main thread, but the audit records the dispatch wiring was left as a TODO
sources: [ADR-0038, audit-digest ADR records line 45]
---
## Context
ADR-0038 (active, load-bearing) defines bridging `runWasi` to a kernel `ProcessHandle` via `spawnWorker`, so large WASI tools (esbuild/tsc/swc) run in a kernel-spawned Worker realm instead of blocking the main thread — unblocks M8 toolchain spawn. Audit note on the ADR: "dispatch wiring left as TODO". So the contract/seam is defined but the actual run-on-spawned-worker dispatch path may not be fully wired (esbuild's current transform runs via `runWasi` directly through the shadow-registry binding; whether it routes through the kernel worker per ADR-0038 needs confirming).
## Options / Next
Verify against code: does `runWasi` for a heavy guest actually dispatch through `globalProcessManager.spawnWorker` + `process-handle.ts`, or run inline on the calling realm? If still inline, complete the dispatch wiring per ADR-0038 (route bytes/preopens/stdio over the kernel worker, surface exit/WasiExit). If already wired, mark ADR-0038's TODO resolved. `packages/runtime-wasi/src/syscalls/process-handle.test.ts` exists — check coverage of the spawned-worker path vs the inline path.
## Reversibility
Reversible if the seam (ADR-0038 public ProcessHandle contract) is unchanged — internal wiring only. IRREVERSIBLE if it changes the kernel/runtime-wasi public surface → confirm against ADR-0038 before widening; that ADR already authorizes the bridge. Gate: confirm current wiring state first.
