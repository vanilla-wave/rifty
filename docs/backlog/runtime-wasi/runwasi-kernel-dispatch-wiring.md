---
area: runtime-wasi
status: draft
title: runWasi → kernel ProcessHandle dispatch wiring (ADR-0038 left as TODO)
created: 2026-06-08
why: ADR-0038 bridges runWasi to kernel spawnWorker so big WASI tools don't block the main thread, but the audit records the dispatch wiring was left as a TODO; keep as future runtime-wasi/kernel wiring work
user_story: As a dev running a heavy WASI tool (20 MB esbuild/tsc/swc) that reads source from stdin, I want it off the main thread without freezing the UI, but today `runWasi` runs inline on the caller stack and the worker entry never pumps stdin into guest fd 0
sources: [docs/research/open-webcontainers-alternative-2026-06.md, ADR-0038, audit-digest ADR records line 45]
---
## Context
ADR-0038 (active, load-bearing) defines bridging `runWasi` to a kernel `ProcessHandle` via `spawnWorker`, so large WASI tools (esbuild/tsc/swc) run in a kernel-spawned Worker realm instead of blocking the main thread — unblocks M8 toolchain spawn. Audit note on the ADR: "dispatch wiring left as TODO". So the contract/seam is defined but the actual run-on-spawned-worker dispatch path may not be fully wired (esbuild's current transform runs via `runWasi` directly through the shadow-registry binding; whether it routes through the kernel worker per ADR-0038 needs confirming). Second gap: even once dispatched, the WASI worker-entry does not pump stdin into the guest, so a dispatched esbuild can't receive transform source. On the off-main-thread heavy guests theme, the 20 MB esbuild guest currently runs `runWasi` inline on the caller stack.
## Options / Next
- (A) Dispatch: verify whether `runWasi` for a heavy guest actually routes through `globalProcessManager.spawnWorker` + `process-handle.ts`, or runs inline on the calling realm. If still inline, complete the dispatch wiring per ADR-0038 (route bytes/preopens/stdio over the kernel worker, surface exit/WasiExit). If already wired, mark ADR-0038's TODO resolved. `packages/runtime-wasi/src/syscalls/process-handle.test.ts` exists — check coverage of the spawned-worker path vs the inline path. Also route `child_process.spawn('*.wasm')` to `createWasiProcess`.
- (B) Worker stdin: pump the spawn stdio stdin `MessagePort` into guest fd 0 (the kernel provides the port; worker-entry needs the async callback). Prove with esbuild reading transform source from stdin.
## Reversibility
Reversible if the seam (ADR-0038 public ProcessHandle contract) is unchanged — internal wiring only. IRREVERSIBLE if it changes the kernel/runtime-wasi public surface → confirm against ADR-0038 before widening; that ADR already authorizes the bridge. Gate: confirm current wiring state first.
