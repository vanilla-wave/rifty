---
area: runtime-js
status: draft
title: Worker lifecycle — parent keepalive, child natural exit and stdio streams
created: 2026-09-15
why: a live Worker currently fails to hold its parent, while a finished kernel Worker never exits; Vitest threads additionally needs Worker stdout/stderr streams and explicit empty execArgv
epic: vitest-run-in-browser
blocked_by: [runtime-js/process-lifecycle-events-exit-code]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/worker-thread-lifecycle-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/worker-threads-kernel-run-to-completion-exit.md, docs/backlog/runtime-js/worker-threads-stdio-streams-empty-exec-argv.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/process.ts, packages/workbench/src/workers/node-entry-bootstrap.ts]
---

## Context

Original finding: parent with a Worker posting after 700 ms exits before its
message (main 51440931a). Current constructor acquires no keepalive ref;
ref/unref are no-ops. Child kernel Worker uses serve:true, so simply adding
parent refs leaves a completed child pinning its parent forever. Counted
parentPort listener lifetime and child natural drain belong to the same unit.

Merged with Worker stdio/empty-execArgv item and the existing kernel natural-exit
defect. Their original observations remain in predecessor documents. Existing
child_process keepalive/terminal observation and process IPC listener refs are
reference owners; do not add a second exit authority or package-specific wait.

## Challenge

challenge: 2026-09-15 — reuse accepted vitest-run-in-browser premise (P3/P4); 2026-09-23 native and Chromium probes confirm the joint Worker lifetime boundary

## Reference contract

Native Node v24.16.0. The same parent/child source runs in a real Node process
and sealed Workbench on Chromium. Evidence records commands and exact outputs.

No parent interval holds the CJS lifetime case. ESM top-level await isolates the
child natural-exit/port cases from the separate missing parent-handle defect.
A host-only test deadline detects hangs; it is never a child keepalive handle.
A parent global sentinel rejected by the child discriminates same-realm fallback.

## Acceptance

1. A CJS parent with only a live Worker receives its delayed message and exit 0,
   then naturally exits 0. Worker.ref/unref are idempotent; ref after unref
   restores liveness; an unref'd Worker does not hold the parent. → I2
2. A kernel Worker with no live handles naturally exits 0 without terminate.
   A parentPort message listener holds its child until a delayed parent request;
   close, removal of the last listener, or unref releases that hold and permits
   natural child exit. → I2
3. Terminating a started message Worker emits one exit and releases its parent
   handle; a later terminate returns undefined without another exit. → I2
4. Worker.stdout/stderr are Readables with pipe, deliver process writes and
   console output exactly, and reach readable EOF. With stdout/stderr true,
   output is captured without automatic forwarding; defaults forward to the
   parent's corresponding fd. Stream completion and worker exit both settle;
   no unsupported EOF-before-exit order is claimed. → I5
5. Explicit execArgv:[] is accepted and overrides nonempty parent node -e
   execArgv; the child observes []. Worker file entries remain real Workers. → I5

## Parity cases

All carriers are `tests/browser-unit/worker-thread-lifecycle.spec.ts`, using
shared fixture source and live `nativeWorkerLifecycle` oracle.

1. parent-live-worker / parent-ref-after-unref / parent-unref: sole handle,
   toggle idempotence, natural parent-exit ordering. → I2
2. child-natural-exit / parent-port-close / parent-port-remove /
   parent-port-unref: child drain versus real message-port listener lifetime. → I2
3. terminate-releases-once: started worker termination, repeated terminal call,
   no leaked ref or duplicate exit. → I2
4. stdio-capture / stdio-default: Readable shape, exact per-fd bytes, console,
   suppression versus forwarding, both EOFs and child exit. → I5
5. explicit-empty-exec-argv: true node -e parent launch, file Worker reports
   empty child execArgv. → I5

## Fault matrix

| axis × operation | honest outcome | fault/transition carrier | trace |
|---|---|---|---|
| observable-order × natural parent drain | late message then child exit before parent exit | parent-live-worker | → I2 |
| torn-state × ref/unref and terminal release | counted once, released once, no leak | parent-ref-after-unref / parent-unref / terminate-releases-once | → I2 |
| sibling-drift × parentPort lifetime release paths | close/remove/unref each permit child drain after reply | parent-port-close / parent-port-remove / parent-port-unref | → I2 |
| observable-order × stdout/stderr completion | exact bytes plus both EOFs and one worker exit | stdio-capture / stdio-default | → I5 |
| provenance-lie × inherited launch options | explicit empty identity wins | explicit-empty-exec-argv | → I5 |

## Out of scope

Worker eval:true and data: entries retain their existing loud ceilings. Nonempty
execArgv override/inheritance, transferList, structured-clone workerData, kernel
runtime-error event identity remain their
existing separately recorded gaps. No full Worker capability claim.

## Decisions

- re-cut: 2026-09-23 — merge worker-threads-stdio-streams-empty-exec-argv and required worker-threads-kernel-run-to-completion-exit into this lifecycle unit; preserve I2/I5 obligations — trace: none
- 2026-09-23 — preparation requires Contract+RED for newly counted handles/streams; native baseline supplies existing child-exit defect authority; no product implementation in this preparation.
- 2026-09-23 — MessagePort/dedicated Worker boundary: no transport loss/duplicate/reorder injection; lifetime termination and caller ref transitions are reachable faults. Source/file validation remains existing worker_threads.test.ts coverage.
