---
area: kernel
status: active
title: Real worker_threads.Worker via kernel spawnWorker / SAB IPC (drop same-realm fallback)
created: 2026-06-08
why: same-realm Worker fallback has no globalThis isolation; real Workers need COI + kernel.setKernelWorkerUrl
sources: [ADR-0011, docs/compat/m10-tooling (follow-up #13), TASKS M6]
---
## Context
`worker_threads.Worker` currently runs the worker body in the same realm when the SAB/worker-url gate is unmet — no `globalThis` isolation, so the "Worker" shares the parent's globals. Real isolation needs cross-origin isolation (ADR-0002) + a host-supplied `kernel.setKernelWorkerUrl` and routing through `kernel.spawnWorker` with SAB IPC (ADR-0011 phase 2), the same path `child_process` uses. Listed as compat follow-up doc item #13.
## Options / Next
Route `worker_threads.Worker` through `kernel.spawnWorker` whenever `isSabIpcSupported() && getKernelWorkerUrl()`, mirroring the child_process worker-backed branch; keep the same-realm path only as an explicitly-degraded fallback (or retire it with process-equals-web-worker). Distinct from the runtime-js "true parallel worker_threads" follow-up (that owns the parallelism shape); this owns the kernel-spawned real-Worker wiring.
## Reversibility
REVERSIBLE — reuses the existing spawnWorker/SAB primitives; no new kernel public surface. Gate: needs COI + worker-url, same prerequisite as the child_process worker path.
