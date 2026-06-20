---
area: runtime-js
status: active
title: worker_threads kernel path — run-to-completion Worker never auto-emits 'exit'
created: 2026-06-21
why: the kernel-backed Worker hardcodes serve:true (to keep a message-driven Worker alive, Node parity + Rolldown's pool), so a Worker that finishes its entry with no live handle is never drain-reaped and never emits 'exit' — Node exits it 0
user_story: As a dev whose kernel-backed `worker_threads.Worker` runs a fire-and-forget script (does work at top-level, posts a result, no listener) and `await`s `once(worker, 'exit')`, I want the worker to exit 0 like Node — but today the kernel path spawns it `serve:true`, the kernel never drain-reaps a serve child, and no 'exit' fires until `worker.terminate()`.
sources: [packages/runtime-js/src/builtins/worker_threads.ts, packages/kernel/src/worker-entry.ts, docs/backlog/kernel/server-shaped-worker-process-lifecycle.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

`startViaKernel` builds the spawn spec with `serve: true` UNCONDITIONALLY
(worker_threads.ts, the `serve: true` line). `serve:true` is correct and required
for the common case: a Node `Worker` with a `parentPort.on('message')` listener
stays alive until terminated, and the keepalive does NOT count the IPC port as a
live handle — so without `serve:true` the kernel's drain
(`finalizeWorkerEntry`: `serve===true && !threw → return`, no `exit` posted) would
reap a message-driven worker the instant its entry resolves, before any round-trip
(the bug the old stdout-only path had; closed by this Vite 8 cut). Rolldown's
emnapi pthread pool is exactly this message-driven shape, so `serve:true` is the
right default for the forcing consumer.

Divergence — the OTHER shape: a run-to-completion Worker (entry resolves with no
live refed handle: no message listener, no timer) exits 0 in Node when its loop
drains. On the kernel path `serve:true` disables the drain-reap, so the kernel
never posts `{type:'exit'}` and the parent's `worker.on('exit')` never fires until
`terminate()`. The same-realm fallback already handles this — after the body runs,
`if (!keepsAlive) void this.terminate(0)`. Pre-PR the kernel spec had no `serve`
(drain-reaped → exited), so this is a behavior change scoped to keep message
workers alive; the run-to-completion edge is untested (only same-realm + the
message-driven Rolldown path are exercised).

## Options or Next

The Node-correct fix is to count the parent-port IPC channel as a keepalive handle
while a `'message'` listener is attached, then spawn the kernel Worker `serve:false`
so the kernel's existing event-loop drain reaps it exactly when Node would
(no listener + no pending work → exit; listener attached → stays alive). That
overlaps `kernel/server-shaped-worker-process-lifecycle` (a serve child that
finished setup) and the keepalive refcount — likely a kernel/keepalive change.
Failing test first (COI/SAB kernel path): a Worker whose script posts once and
returns emits `'exit'` 0 without `terminate()`; a Worker that attaches a
`parentPort.on('message')` stays alive (no premature exit).

Keep `serve:true` until then (message workers + Rolldown depend on it); the edge is
an explicit `TODO(backlog: runtime-js/worker-threads-kernel-run-to-completion-exit)`
marker at the `serve:true` site, not a silent hang.

## Reversibility

REVERSIBLE provisional today (a documented divergence + TODO marker). The robust
fix touches the kernel keepalive/drain contract for ports — promote to an ADR if
it changes kernel public behavior (same gate as
[[server-shaped-worker-process-lifecycle]]).
