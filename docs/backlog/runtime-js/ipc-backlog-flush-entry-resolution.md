---
area: runtime-js
status: draft
title: Release buffered worker IPC after entry module resolution (not setTimeout(0))
created: 2026-06-20
why: the #ipcBacklog flush uses setTimeout(0) which only works while the entry module body fits one macrotask — Node delivers IPC strictly on event-loop turns, never mid-eval
user_story: As a worker entry that attaches its 'message' listener early but sets its handler later in the same module, I want buffered parent frames delivered only AFTER my module fully evaluated — like Node — but today delivery is a setTimeout(0) macrotask that merely happens to land after a single-macrotask entry body.
sources: [handoff-vite8-refactor-tails.md #4, packages/runtime-js/src/ipc/install-process.ts]
code: [packages/runtime-js/src/ipc/install-process.ts, packages/kernel/src/worker-entry.ts]
---

## Context

`WorkerNodeProcessShim` buffers parent `ipc:message` frames that arrive before a
`'message'` listener attaches (ADR-0045 / ADR-0146), then flushes them. The flush
was moved `queueMicrotask` → `setTimeout(0)` so a buffered frame lands AFTER the
entry module finishes evaluating, not mid-eval. The forcing case: Rolldown's
`wasi-worker.mjs` calls `parentPort.on('message', d => globalThis.onmessage(d))`
near the TOP but assigns `globalThis.onmessage = …` on its LAST line; a microtask
flushed the `{__emnapi__:load}` frame in the gap → "globalThis.onmessage is not a
function".

`setTimeout(0)` works **because the entry module body runs synchronously in one
macrotask**, so a macrotask scheduled during it fires after the whole body
(including the last-line handler assignment). It is fragile, not robust: if an
entry attaches its listener in one macrotask but sets its handler in a LATER one
(awaits between the `on(...)` and the handler assignment), the flush can still
land in the gap. Node never has this problem — IPC/worker messages deliver on
event-loop turns, never mid module-eval, regardless of the module's internal
async shape.

## Options or Next

Hold inbound delivery until the entry module **fully resolves**:
- The kernel bootstrap (`runEntryLifecycle`) knows exactly when `runEntry()`
  resolves. A **kernel post-entry hook** (symmetric to `setKernelPreEntryHook`,
  run for EVERY child right after the entry resolves and before finalize) would
  let `install-process` flip the shim from "buffer" to "deliver live" at the
  Node-correct moment.
- The existing **drain hook** can't carry this: it runs only for
  `serve !== true` children, but the Rolldown worker_threads children are spawned
  `serve: true` — exactly the ones that need the buffered `{__emnapi__:load}`
  frame. So a dedicated post-entry hook (all children) is required.
- A new kernel public API (`setKernelPostEntryHook`) is **IRREVERSIBLE** →
  promote this item to an ADR before implementing.

Keep the current `setTimeout(0)` until then (Node-aligned, working, commented).
Guard: do not regress `install-process-ipc.test.ts`; a robust version adds a test
where the entry sets its handler a macrotask AFTER attaching the listener and the
frame still arrives.

## Reversibility

REVERSIBLE provisional: today's `setTimeout(0)` is a CHANGELOG-recorded,
Node-aligned mechanism with a `TODO(backlog: runtime-js/ipc-backlog-flush-entry-resolution)`
marker at the flush site — an explicit, documented edge, not a silent stub. The
robust fix introduces a kernel public API → IRREVERSIBLE, recorded as a
superseding ADR when undertaken.
