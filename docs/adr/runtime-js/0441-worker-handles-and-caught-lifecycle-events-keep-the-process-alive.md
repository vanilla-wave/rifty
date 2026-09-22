# ADR 0441: Worker handles and caught lifecycle events keep the process alive

Status: Accepted
Date: 2026-09

> TL;DR: A live `worker_threads.Worker` holds the existing event-loop ref until exit or `unref()`. A user `uncaughtException` / `unhandledRejection` listener receives the event and the process continues. `process.exit()` with no argument uses `process.exitCode` and emits `exit`. Extends ADR-0152 §1 and §3; nothing in ADR-0152 is rewritten.

## Context

ADR-0152 counts a narrow handle set (timers, immediates, dynamic imports; fetch added by ADR-0158) and records an unhandled rejection as a failure that exits 1. Vitest's default `forks` pool and its `threads` pool both wait on a worker that posts back after the parent has otherwise gone idle. A `Worker` that does not hold the loop is reaped before that message, so `vitest run` exits 0 with no reporter output. The same run installs `uncaughtException` / `unhandledRejection` handlers that must observe the error and continue, and it calls `process.exit()` so the code already stored in `process.exitCode` is the code that wins.

## Decision

**1. `worker_threads.Worker` is a keepalive handle (extends ADR-0152 §1).**
Construction calls the existing `ref()`. `finish()` and `Worker.unref()` call `unref()`. `Worker.ref()` holds again. No second counter, epoch, or ledger.

**2. A listener owns the event (extends ADR-0152 §3).**
A timer callback that throws emits `uncaughtException` when that listener exists and does not rethrow. With no listener, the error still propagates. `unhandledrejection` emits `unhandledRejection` and `preventDefault`s when that listener exists, and does not record a drain failure. With no listener, the existing record-and-exit-1 path stays.

**3. `process.exit()` with no argument reads `process.exitCode`.**
An explicit argument is still coerced. The process emits `exit` with the uint8 code before the internal exit throw.

## Consequences

- (+) A parent that only waits on a Worker stays alive until the worker finishes or is `unref`d.
- (+) User lifecycle handlers observe the error and continue. The no-handler rejection path is unchanged.
- (−) The counted handle set is now timers, immediates, imports, fetch, and `worker_threads.Worker`. It is still not the full libuv set. `child_process` already held the loop.
- Guard: `packages/runtime-js/src/vitest-run-surfaces.test.ts`, `packages/runtime-js/src/internal/event-loop-keepalive.test.ts`.

## References

- ADR-0152 §1 (narrow handle set), §3 (unhandled rejection exits 1)
- ADR-0158 (fetch extends the same set the same way)
- `docs/public/compat/vitest.md`
