---
area: runtime-js
status: active
title: worker_threads kernel-path 'error' event for worker-runtime uncaught exceptions
created: 2026-06-20
why: a kernel-backed Worker that throws at runtime emits only 'exit' 1, not Node's 'error' (with the real Error) then 'exit'
user_story: As a dev whose `worker_threads.Worker` script throws, I want the parent `worker.on('error', e => …)` to receive the real Error like Node — but today on the kernel-backed path only `'exit'` (code 1) fires; the stack goes to the worker's stderr, never to an `'error'` event.
sources: [handoff-vite8-refactor-tails.md #6, packages/runtime-js/src/builtins/worker_threads.ts]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/kernel/src/worker-entry.ts]
---

## Context

Node `Worker` emits `'error'` (carrying the thrown `Error`) for a worker-runtime
uncaught exception / unhandled rejection, THEN `'exit'` with code 1.

Rifty divergence by path:
- **same-realm fallback** — `startSameRealmAsync`'s `catch` already calls
  `emitWorkerError(err)` → `'error'` fires with the real Error. ✔ Node-parity.
- **kernel-backed path** — the child realm's throw is caught by the kernel
  bootstrap (`runEntryLifecycle`), which writes the stack to the worker's
  **stderr** and exits 1. The parent's `handle.on('exit')` → `finish(1)` emits
  only `'exit'` 1. `'error'` fires ONLY on a *spawn* failure (the `startViaKernel`
  try/catch), never for a runtime throw inside the worker. ✘

Why not just synthesize an `Error` from exit code 1: that would LIE about the
cause (Fidelity — no fake impls). The real Error must cross the realm boundary.

## Options or Next

Real cross-realm propagation (additive, no public-API break):
1. The node-entry child installs an `uncaughtException` / `unhandledrejection`
   handler that serializes the Error (`name`/`message`/`stack`/`code`) and posts
   an IPC `{ kind: 'worker:error', error }` frame via `process.send` BEFORE the
   kernel reaps it. Kernel stays Node-API-agnostic (ADR-0039) — the frame is a
   runtime-js convention over the existing ADR-0045 fork-IPC channel.
2. `worker_threads.Worker` maps an inbound `worker:error` frame to
   `emitWorkerError(deserialize(frame.error))`, so `'error'` precedes the
   `'exit'` the kernel still posts.
3. Decide structured-clone vs the plain field subset for the Error (match the
   `workerData` JSON-safe policy or widen deliberately).

Gate: a kernel-backed-path test (COI/SAB) asserting `'error'` (real message)
fires before `'exit'` 1 — the same-realm path already covers the event shape.

## Reversibility

REVERSIBLE — additive IPC frame + handler, recorded as this backlog item with a
`TODO(backlog: runtime-js/worker-threads-kernel-error-event)` marker at the
kernel-path exit site. The same-realm path keeps Node-parity today; the gap is
the kernel path only, and it is an explicit documented divergence (loud stderr +
honest `'exit'` 1), never a silent stub.
