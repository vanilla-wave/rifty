---
area: runtime-js
status: draft
title: Work already queued when process.exit() runs still executes and prints in in-process hosts
created: 2026-11-22
why: Node ends the process inside exit(); rifty records the terminal and ends the run at the drain's next tick, so microtasks of the same checkpoint and timers/immediates ripe before that tick still run and print.
sources: [docs/public/compat/isolate-host.md, docs/backlog/runtime-js/node-eval-queued-exit-overrides-pending-fatal.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Isolate host with the port-less eval terminal fix (PR #416, 2026-11-22), `node -e` v24.16.0
(Node prints nothing in each; status matches):

- `Promise.resolve().then(() => process.exit(0)); Promise.resolve().then(() => console.log('queued'))` → stdout `queued`.
- `setTimeout(() => console.log('timer'), 0); setInterval(() => console.log('interval'), 1); setImmediate(() => console.log('immediate')); Promise.resolve().then(() => process.exit(2))` → all three print.
- Same before that fix from a timer (main `50c9d8bf1`): `setTimeout(() => process.exit(3), 1); setTimeout(() => console.log('t2'), 1)` → `t2`;
  `….then(() => process.exit(3)).finally(() => console.log('fin'))` → `fin`.

No-COI project command, same fix: `node -e` with `setTimeout(() => console.log('L|timer'), 0)` queued before
`Promise.resolve().then(() => process.exit(3))` prints `L|timer` (exit 3).
A queued `nextTick` after an exit in `nextTick` does not run; a timer due later (50 ms) does not run.
Cause: `exit()` throws its signal and records the terminal; a port-less process ends when its drain's
next macrotask tick reads it (`awaitDrain`), so what the realm already queued runs first. Kernel
children (control-port exit, also async) unprobed. Twin of `node-eval-queued-exit-overrides-pending-fatal`
(the fatal terminal, same deferral); `distribution/isolate-host-uncaught-throw-waits-for-microtask-checkpoint`
is its unbounded form (an endless microtask chain after `exit(3)` too: `timeout`, Node exit 3). Not a timing tolerance: a fix ends the run at the terminal (the
isolate host's child sees no request then — ADR-0557 §6 removed a guest-reachable `done`) or stops
timers and output once the terminal exists. Pinned: corpus ceilings `exit-in-microtask-with-ripe-timers`,
`exit-in-microtask-skips-queued-microtask` (`packages/isolate-host/tests/corpus.ts`, both lanes).

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
