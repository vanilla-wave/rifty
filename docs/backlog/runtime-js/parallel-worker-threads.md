---
area: runtime-js
status: draft
title: True parallel Web Workers for worker_threads.Worker
created: 2026-06-08
why: worker_threads falls back to same-realm execution when the kernel spawnWorker capability is unavailable — not truly parallel
user_story: As a dev spawning `worker_threads.Worker` for CPU-parallel work, I want a real isolated realm with its own module loader — but today without COI/SAB + `kernelWorkerUrl` it falls back to same-realm execution (no `globalThis` isolation, shares the parent's `require()`), not truly parallel.
sources: [TASKS M6 follow-up, compat/m10-tooling.md Known-limitations]
---
## Context
`worker_threads.Worker` falls back to SAME-REALM execution when the kernel `spawnWorker` capability is unavailable (no SAB IPC, no configured `kernelWorkerUrl`). Same-realm path runs the worker script in the parent's realm: no `globalThis` isolation, no separate module loader (`require()` resolves against the parent's loader, not its own); `workerData`/`parentPort` still propagate. One-shot warn fires on first fallback. Real Workers require cross-origin isolation (SAB) + `kernel.setKernelWorkerUrl(...)` at host boot (ADR-0011 phase 2). Follow-ups doc item #13.
## Options / Next
Next: ensure the SAB-backed kernel `spawnWorker` path is wired/configured in every host that needs real parallelism (set `kernelWorkerUrl` at boot under COI), so `Worker` gets a real isolated realm + its own module loader instead of the same-realm fallback. Conformance already gates SAB-only suites on `crossOriginIsolated && getKernelWorkerUrl()`.
## Reversibility
Parked behind the COI/SAB + `kernelWorkerUrl` boot gate (ADR-0011 phase 2 infra), not a single-PR change. The same-realm fallback is an honest documented degradation (warns), not a silent stub.
