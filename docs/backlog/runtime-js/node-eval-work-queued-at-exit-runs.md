---
area: runtime-js
status: draft
title: Work already queued when process.exit() runs still executes in in-process hosts
created: 2026-11-22
why: Node ends the process inside exit(); rifty records the terminal and ends the run at the drain's next tick, so what the realm already queued still runs — invisible in the isolate host (output dropped, status fixed) but it costs time there, and a no-COI command still prints it.
sources: [docs/public/compat/isolate-host.md, docs/public/compat/process.md, docs/backlog/runtime-js/node-eval-queued-exit-overrides-pending-fatal.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/timers.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Measured 2026-11-22 (PR #416), `node -e` v24.16.0 runs none of it. What still runs after `exit()`:

- V8-owned: microtasks of the same checkpoint (`Promise.resolve().then(() => process.exit(0)); Promise.resolve().then(f)`),
  one an `'exit'` listener queues. JS cannot drop V8's microtask queue; only ending the isolate stops them.
- rifty-owned: a timer or `setImmediate` ripe before the drain's first tick (`setTimeout(f, 0)` queued before an exit
  from a microtask; `setTimeout(() => process.exit(3), 1); setTimeout(f, 1)`). Dispatch points: `KeepaliveTimerHandle`
  (`fireTimeout`, `shouldRunInterval`) and the immediate queue in `timers.ts` — several, and shared with kernel
  children (control-port exit, async; unprobed). A queued `nextTick` after an exit in `nextTick` already does not run.
- Output: the isolate host drops guest stdout/stderr once the process has its terminal (`entry.ts` output sink), and
  the status is the terminal's, so `runCode` equals Node (corpus `exit-in-microtask-*`, `exit-listener-queues-microtask`).
  Left there: time — a long queued job delays the result; an endless one is
  `distribution/isolate-host-uncaught-throw-waits-for-microtask-checkpoint` (`timeout`).
  A no-COI project command prints it: `node -e` with `setTimeout(() => console.log('L|timer'), 0)` queued before
  `Promise.resolve().then(() => process.exit(3))` prints `L|timer` (exit 3); expected-failure row
  `eval-microtask-exit-ripe-timer` (`tests/no-coi/no-coi-process-exit-status.spec.ts`).

Twin of `node-eval-queued-exit-overrides-pending-fatal` (the fatal terminal, same deferral). Not a timing
tolerance: a fix ends the run at the terminal (the isolate host's child sees no request then — ADR-0557 §6
removed a guest-reachable `done`) or stops rifty's dispatchers once the terminal exists.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
