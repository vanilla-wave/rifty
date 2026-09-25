# ADR 0445: Dispatch Node process lifecycle events before terminal handling

Status: Accepted
Date: 2026-09-23

> TL;DR: One dispatch on the realm's active `NodeProcess` delivers uncaught errors and unhandled rejections to Node's listeners before any terminal path runs. A handled error cancels the browser report and the program continues. `exit()` follows Node: `exitCode` starts `undefined`, no argument means `exitCode`, and `'exit'` fires once before the kernel exit request. Natural exit calls the same `exit()`. The drain settles with the process's first exit terminal. A zero-ref drain confirms idleness across one more host task before it settles.

Partially supersedes ADR-0152 §3 (a rejection a process listener handles is
canceled and not recorded; a no-listener rejection's stderr and exit request
run at the trap, the drain records that exit) and partially supersedes
ADR-0152 §1 (the first zero-ref sample no longer settles the drain); corrects
ADR-0157 §1's `exit()` clause (a no-argument call no longer sets `exitCode`;
`'exit'` and the kernel exit request come before the throw). Drain ownership
(ADR-0385) and the loud no-listener default stay.
Evidence: `docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md`.
Independent DEC-2 decision review, 2026-09-25: justified-with-fixes; each
overturned clause is now named here with one verb, and dated notes land in
ADR-0152 §1/§3, ADR-0157 §1 and the README §Corrections rows.

## Context

vitest 4.1.11 builds on Node's process lifecycle (evidence §V): pool workers
install `uncaughtException`/`unhandledRejection` listeners, the main process
exits through `process.exitCode = …; process.exit()` and a `once('exit')` hook
that schedules `setTimeout(() => process.exit(), 1)`, and cac's Startup Error
path sets `exitCode` only while it reads `undefined`. On BASE (evidence §B)
rifty calls no listener except for `nextTick` throws, never emits `'exit'`,
reads `exitCode` as `0`, ignores it in `exit()`, drops a `nextTick` throw with
no listener, exits 1 instead of 7 when a listener throws, and exits 0 when
Chromium dispatches `unhandledrejection` after the drain's first zero-ref
sample. Node v24.16.0 facts: evidence §O1–§O3.

## Decision

1. **One dispatch.** The realm's active `NodeProcess` owns delivery of an
   uncaught error `(err, origin)` and an unhandled rejection `(reason,
   promise)`. Its callers are the existing realm `error` and
   `unhandledrejection` traps, the `nextTick` drain, and the program/eval
   lifecycle's entry catch (origin `uncaughtException` for a CommonJS entry,
   `unhandledRejection` for an ES module entry, as Node reports module
   evaluation). Order, as Node: `uncaughtExceptionMonitor`, then
   `uncaughtException` listeners. A rejection goes to `unhandledRejection`
   listeners `(reason, promise)`; without one, to `uncaughtException` with
   origin `unhandledRejection`, the reason wrapped as Node's
   `UnhandledPromiseRejection` (`ERR_UNHANDLED_REJECTION`, V8's
   side-effect-free reason rendering) unless it has an own `stack`. A
   Node-callback builtin (fs callbacks, zlib convenience, `util.callbackify`)
   runs its callback outside the promise reaction that settled it
   (`runNodeCallback`): a throw is an uncaught exception, not a rejection.
   Mechanism: `builtins/process-lifecycle-events.ts`, reached across bundles
   through a `Symbol.for` slot on the process.
2. **Handled.** The trap calls `preventDefault()`, records nothing and claims
   no eval terminal; the loop keeps draining.
3. **Unhandled.** `exitCode` becomes 1, `'exit'` is emitted (rule 5), then a
   throw takes the existing terminal path unchanged: default Worker report,
   or the eval terminal (ADR-0339/0342): stderr + status 1. A rejection takes
   the eval terminal, else its fatal terminal runs in the trap at once, as
   Node exits inside its handler: stderr, then the kernel exit request with
   `uint8(exitCode ?? 1)` read after the listeners; the drain records that
   exit signal, not the reason, so no task that runs after the trap overrides
   the status and nothing prints twice. An `exit()` that already requested the
   kernel exit (in the fatal `'exit'`, or before the rejection is seen) keeps
   its status and nothing prints. A `nextTick` throw with no listener takes
   this path instead of being dropped: later ticks never run and the error
   reaches the realm `error` trap once, undispatched.
4. **Listener throws.** A throw from an `uncaughtException` listener is fatal
   with status 7, stderr naming it, and no `'exit'` event — never re-dispatched.
   The `RIFTY_PROCESS_EXIT` signal is control flow: never dispatched, and it
   carries its own code out of any listener.
5. **exit().** `exitCode` is `undefined` until assigned; assigning `null` or
   `undefined` resets it, other values keep today's validation. `exit()` with
   an argument assigns it (`exit(undefined)` resets). The first call marks the
   process exiting and emits `'exit'` with `exitCode ?? 0`, then requests the
   kernel exit with `uint8(exitCode ?? 0)` read after the listeners. `exit()`
   inside a listener requests its own code and ends the emission; the control
   port sends one request, so any later call requests nothing more. Every call
   throws the exit signal. An in-process owner reusing one process per
   invocation (no-COI, the Node-hosted execSync substitutes) resets it with
   `resetNodeProcessExit` (`./builtins/process`).
   Corrected 2026-09-25: the drain settles with the active process's first
   terminal (this rule, rule 3, rule 4), not only rule 3's record. The request
   reached only the control port, so an in-process host (no-COI command, runBin)
   drained on and reported 0 for a listener throw, and ran later timers. A
   kernel child's status is unchanged: the drain and the control request carry
   the same first terminal. The no-COI command takes its status from that
   terminal and clears the invocation's timers. It replaces the realm only when
   another live handle (port, pending import/fetch) outlives the terminal.
   runBin ends with rule 6's natural exit.
6. **Natural exit.** A lifecycle owner that sees the loop drain calls `exit()`
   with no argument — the program/eval lifecycle (after the `-p` print) and the
   execSync program branch (after its drain, which now precedes it). Worker
   threads keep their current exit path (map item 8).

   > **Corrected (2026-09-25, ADR-0446):** worker threads no longer keep their
   > exit path: a worker-thread realm drains uncapped, then exits naturally.
   > Every owner's natural exit (program/eval, execSync, worker thread) calls
   > the `NodeProcess` exit the bootstrap captured before user code, never the
   > reassignable `process.exit` property. The Consequences gap "worker-thread
   > natural exit stays with map item 8" is closed; the no-COI in-process
   > command stays a gap (draft
   > `distribution/no-coi-command-natural-exit-reassigned-exit`).

7. **Late rejection.** `awaitDrain` does not settle as drained on the first
   zero-ref sample: it settles only after a following host task confirms zero
   refs and no new rejection, so an `unhandledrejection` task Chromium queued
   behind the first sample reaches rule 1 first. Absorbs the drain race of backlog
   `runtime-js/late-unhandled-rejection-drain`; the already-queued-callback case
   stays there (Consequences).

## Alternatives

- Wrap each callback source (timer, immediate, fs callback, listener) in
  try/catch and emit (PR #349's route): killed — Node's catch set spans every
  callback source plus entry throws (evidence o01–o04, o23–o25); one copy per
  source is sibling drift, and #349 covered timers only.
- A separate handler lifecycle or second drain owner: killed — ADR-0385 keeps
  one foreground drain; delivery needs no new owner (REV-7).
- Late rejection by Node-style tracking (patch `Promise` to see rejections
  synchronously): killed — native async-function rejections and captured
  `then` intrinsics bypass a JS patch (process.ts header limitation).
- Late rejection by a fixed delay: killed — a timing guess, not an order.
- Terminal read at each realm trap and the `nextTick` drain (2026-09-25):
  killed — an `exit()` a guest catches, or an emitter swallows
  (`child_process` owner events), reaches no trap. One read at the drain
  covers every terminal.
- No-listener rejection terminal at the next drain sample (ADR-0152 §3's
  record): killed — a user task in between can call `exit(0)` and send the
  first kernel request, so the program exits 0 after `'exit'` 1 (evidence §F).
- Rethrow it into the default Worker report: killed — the report carries the
  message without the stack and is a parent-side task with no order against a
  later exit request.
- Keep `exitCode` numeric and map `0` to "unset": killed — `exitCode = 0` is a
  real assignment Node distinguishes (`== null` checks, evidence §V).

## Consequences

- Node lifecycle consumers (vitest, cac CLIs) recover from handled errors and
  see the final `'exit'`; unset `exitCode` presents as `undefined`, and
  numeric readers treat it as 0.
- Published `./builtins/process` API: `NodeProcess.exitCode` is
  `number | undefined`; `resetNodeProcessExit(process)` is new. Workbench
  `NodeLifecycleDeps` loses `readExitCode` (natural exit passes no code).
- No-listener errors stay loud: stderr + status 1; a rejection's status is
  final at the trap on every kernel child (program, `.bin`, fork, execSync,
  worker thread). A Node callback queued before Chromium's
  `unhandledrejection` task (same-turn `setTimeout(0)`/`setImmediate`, a timer
  ripe at the same time, an fs callback) still runs before the trap, and its
  `exit(0)` exits 0 where Node exits 1 (evidence §F2). User fork 2026-09-24:
  Out of scope + compat ⚠️; the fence (≥ 2 host-task hops per callback,
  reorders ADR-0085) → backlog `runtime-js/late-unhandled-rejection-drain`.
- Zero-ref drains settle one host task later.
- Explicit gaps (compat rows): `beforeExit` and `rejectionHandled` are not
  emitted; `setUncaughtExceptionCaptureCallback` is absent; worker-thread
  natural exit stays with map item 8. No-COI in-process hosts (2026-09-25):
  a no-listener throw keeps the realm's default report (the toolchain Worker
  crashes), and a command's eval fatal rejection or a terminal with a live
  non-timer handle replaces the realm (draft
  `distribution/no-coi-command-unhandled-rejection-exit`).
