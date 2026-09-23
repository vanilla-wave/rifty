# ADR 0445: Dispatch Node process lifecycle events before terminal handling

Status: Accepted
Date: 2026-09-23

> TL;DR: One dispatch on the realm's active `NodeProcess` delivers uncaught errors and unhandled rejections to Node's listeners before any terminal path runs. A handled error cancels the browser report and the program continues. `exit()` follows Node: `exitCode` starts `undefined`, no argument means `exitCode`, and `'exit'` fires once before the kernel exit request. Natural exit calls the same `exit()`. A zero-ref drain confirms idleness across one more host task before it settles.

Partially supersedes ADR-0152 §3 (a rejection a process listener handles is
canceled and not recorded) and moves ADR-0152 §1's settle point one host task
later; extends ADR-0157 §1 `exit()`. Drain ownership (ADR-0385) and the loud
no-listener default stay.
Evidence: `docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md`.

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
   side-effect-free reason rendering) unless it has an own `stack`.
2. **Handled.** The trap calls `preventDefault()`, records nothing and claims
   no eval terminal; the loop keeps draining.
3. **Unhandled.** `exitCode` becomes 1, `'exit'` is emitted (rule 5), then the
   existing terminal path runs unchanged: default Worker report or drain
   rejection (ADR-0152 §3), or the eval terminal (ADR-0339/0342): stderr +
   status 1. A `nextTick` throw with no listener takes this path instead of
   being dropped.
4. **Listener throws.** A throw from an `uncaughtException` listener is fatal
   with status 7, stderr naming it, and no `'exit'` event — never re-dispatched.
   The `RIFTY_PROCESS_EXIT` signal is control flow: never dispatched, and it
   carries its own code out of any listener.
5. **exit().** `exitCode` is `undefined` until assigned; assigning `null` or
   `undefined` resets it, other values keep today's validation. `exit()` with
   an argument assigns it (`exit(undefined)` resets). The first call marks the
   process exiting and emits `'exit'` with `exitCode ?? 0`, then requests the
   kernel exit with `uint8(exitCode ?? 0)` read after the listeners. `exit()`
   inside a listener requests its own code and ends the emission; any later
   call requests nothing more. Every call throws the exit signal.
6. **Natural exit.** A lifecycle owner that sees the loop drain calls `exit()`
   with no argument — the program/eval lifecycle (after the `-p` print) and the
   execSync program branch (after its drain, which now precedes it). Worker
   threads keep their current exit path (map item 8).
7. **Late rejection.** `awaitDrain` does not settle as drained on the first
   zero-ref sample: it settles only after a following host task confirms zero
   refs and no new rejection, so an `unhandledrejection` task Chromium queued
   behind the first sample reaches rule 1 first. Absorbs backlog
   `runtime-js/late-unhandled-rejection-drain`.

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
- Keep `exitCode` numeric and map `0` to "unset": killed — `exitCode = 0` is a
  real assignment Node distinguishes (`== null` checks, evidence §V).

## Consequences

- Node lifecycle consumers (vitest, cac CLIs) recover from handled errors and
  see the final `'exit'`; unset `exitCode` presents as `undefined`, and
  numeric readers treat it as 0.
- No-listener errors stay loud: stderr + status 1 (ADR-0152 §3).
- Zero-ref drains settle one host task later.
- Explicit gaps (compat rows): `beforeExit` and `rejectionHandled` are not
  emitted; `setUncaughtExceptionCaptureCallback` is absent; the no-COI
  in-process project command keeps its own settlement; worker-thread natural
  exit stays with map item 8.
