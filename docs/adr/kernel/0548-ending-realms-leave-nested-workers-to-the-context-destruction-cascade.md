# ADR 0548: Ending realms leave nested Workers to the context-destruction cascade

Status: Accepted
Date: 2026-10-25

> TL;DR: a realm that an ancestor kill is ending never calls `Worker.terminate()`
> on its nested Workers; it retires their rifty channels and its own termination
> ends their threads.

## Context

Chromium 148 (`branch-heads/7778`, `third_party/blink/renderer/core/workers`):
a child's termination notice (`DidTerminateWorkerThread` →
`WorkerThreadTerminated`) is posted to the parent context's `kInternalDefault`
queue. A parent's `PrepareForShutdownOnWorkerThread` (after `terminate()`, or
at the end of a `close()` task) disposes that queue, dropping a queued notice.
`num_child_threads_` never reaches 0, so the parent — and every ancestor
waiting on it — keeps its thread and isolate until the renderer dies. A child
terminated by its parent's own context destruction posts after the runners
switched to `CleanupTaskRunner`, so it is never dropped. No script-visible
signal follows the notice.

Standalone repro (page → parent → child, no rifty): parent terminates child
then stays busy, page terminates parent: 20/20 parents retained, renderer OS
threads 15 → 54 without CDP. Page terminates the busy parent instead: 0/20 with
1 or 8 children. KerfDesk PR #1288 reports the same drop.

ADR-0333 orders an ancestor kill child-first: realm R terminates its federated
child C, publishes `process.settle` through a blocking ring call, then its
owner cuts and terminates R about one task later — the drop's exact shape.
CI: Workbench close retained the owner and reopened Vite
(`workbench-vite-lifecycle.spec.ts`, 4 of 4 browser-unit reds 2026-10-23..25);
closing a Workbench over a live Vite run retained two Workers 6/10 locally.

## Decision

- `control:kill-tree` carries a required `cascade` boolean: the sender is
  committed to ending the realm that hosts the target — the route's physical
  owner or one of its tree ancestors has an admitted kill, or the sender's own
  realm is ending.
- A realm receiving `cascade: true` latches `ProcessManager` one-way as ending.
  The terminal sequence is unchanged (fence, child-first signal, cut, drain,
  `exit`/`close`, settlement — ADR-0333); only the physical end becomes
  `SpawnWorkerResult.release()`: input closed, ring detached, listeners
  removed, error guard kept, no `terminate()`. Every frame an ending realm
  sends carries `cascade: true`.
- A live realm (owner root, a parent outliving its killed child) still calls
  `terminate()` at once.
- Correction to ADR-0326 §Finite process: for a Worker of an ending realm, the
  physical termination proof is the committed ancestor termination of its host
  realm; `terminate()` returning never proved thread release.

## Consequences

- A released child stays a fenced zombie (ring, ports and input closed) until
  its host ends: one owner task, bounded by the 1 s descendant deadline plus
  Chromium's 2 s forcible termination of a busy host.
- Residuals (`backlog/kernel/nested-worker-notice-drop-residuals`): a guest
  kill or a child's natural exit just before its realm ends; a nested child
  that self-closes; `spawnKernelWorker` rollback; Workbench shutdown over a
  live run at the owner level; the support probe Worker.
- Kill condition: Chromium delivers a child's termination notice queued before
  its parent's shutdown. Re-run
  `docs/backlog/kernel/reference/nested-worker-notice-drop-repro` on each
  Chromium bump (`explicit-busy` retained → workaround still needed).
- Proof: `tests/browser-unit/nested-worker-retirement.spec.ts` (RED 21 retained
  Workers per run; green) and the unchanged zero-Worker assertion in
  `workbench-vite-lifecycle.spec.ts`.
