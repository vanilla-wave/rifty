---
area: runtime-js
status: draft
title: Work already queued when process.exit() runs still executes
created: 2026-11-22
why: Node ends the process inside exit(); rifty records the terminal and the realm ends later (the drain's next tick, or the kernel's async control exit), so what the realm already queued still runs — invisible in the isolate host (output dropped, status fixed) but it costs time there, and kernel children and no-COI commands still print it.
sources: [docs/public/compat/isolate-host.md, docs/public/compat/process.md, docs/backlog/runtime-js/node-eval-queued-exit-overrides-pending-fatal.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/timers.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Sandbox (ADR-0568): a member of the lifecycle class, compat ⚠️ (row "A run's lifecycle and exit status", measured in `reference/isolate-host-sandbox-lifecycle-class.md`). Owner: runtime-js. Trigger: the next process-exit change in runtime-js, or a sandbox consumer finding a file written after `process.exit()`.

Measured 2026-11-22 (PR #416), `node -e` v24.16.0 runs none of it. Who dispatches what still runs after `exit()`:

- V8: microtasks of the same checkpoint (`Promise.resolve().then(() => process.exit(0)); Promise.resolve().then(f)`),
  one an `'exit'` listener queues. JS cannot drop V8's microtask queue; only ending the isolate/Worker stops them.
- rifty: a timer, `setImmediate` or fs callback ripe before the drain's first tick, a timer an `'exit'` listener arms.
  Dispatch points: `KeepaliveTimerHandle` (`fireTimeout`, `shouldRunInterval`), the immediate queue (`timers.ts`), fs
  callback scheduling (`fs.ts`, `fs-streams.ts` `queueMicrotask`) — several, shared with kernel children. A queued
  `nextTick` after an exit in `nextTick` already does not run.
- Checked dead end for one point: settling `awaitDrain` at once (`tick()` without the macrotask hop) when a
  terminal already exists stops the isolate host's ripe timers but breaks no-COI `setImmediate` ordering
  (PR #416 external review probe).

Where it shows:

- Isolate host: guest stdout/stderr is dropped once the process has an explicit terminal (`entry.ts` output sink;
  not at a natural exit, where Node prints what `'exit'` listeners queue; past the first hop there:
  `distribution/isolate-host-natural-exit-listener-queued-work`), and the status is the terminal's, so
  `runCode` equals Node (corpus `exit-in-microtask-*`, `exit-listener-*`). Left: time — a long queued job delays the
  result, an endless one is `distribution/isolate-host-uncaught-throw-waits-for-microtask-checkpoint` (`timeout`),
  one allocating past the heap limit ends as `termination: 'memory'`; and an `exit()` inside an `'exit'` listener at
  a natural exit still prints the microtask queued before it (corpus ceiling
  `exit-in-exit-listener-at-natural-exit-queued-microtask`).
- Isolate host, the diagnostic of an uncaught throw from queued work: `queueMicrotask(() => { throw new Error('AFTER') });
  process.exit(3)` → stderr `Error: AFTER`, exit 3 (Node: empty stderr) at `c2621b50c`: the guest's `writeDiagnostic` →
  `writeHost` bypassed the output drop (same at `50c9d8bf1`). Fixed by PR #421: the realm-uncaught terminal finds the
  exit's terminal and prints nothing (`guest-seam.test.ts`).
- No-COI project command (status Node's, extra output pinned exactly in `declared:` rows of
  `tests/no-coi/no-coi-process-exit-status.spec.ts`): after an `exit()` from a microtask of `-e`, a 0 ms timer, a
  `setImmediate`, an fs callback, a timer and a microtask an `'exit'` listener queues; after a synchronous `exit()` or
  one in a timer, a microtask queued before it.
- Kernel children (COI): a microtask queued before a synchronous `exit()` or one in a timer prints (external review
  probe, PR #416; not re-measured here).

Lead, untried (PR #424 cross-review): in the isolate guest every host delivery (a timer's expiry,
an unhandled rejection) already passes one gate on the run phase and runs nothing once the run's
status is out; the runtime's terminal comes earlier — at `exit()` or a fatal thrown in a callback — and
between the two a timer already due still runs (`setTimeout(() => fs.writeFileSync('t', '1'), 0);
Promise.resolve().then(() => process.exit(2))` keeps `t` in a sandbox, Node exit 2 without it; an
endless such timer ends the run `timeout` in both hosts). Closing that gate at the terminal would match
Node on both isolate hosts for host-delivered work, and move `runCode` corpus pins of today's
divergence (they pin rifty's outcome, not Node's: a timer's `exit(0)` overriding a pending fatal,
`node-eval-queued-exit-overrides-pending-fatal`; output of callbacks due beside `exit()`), so it needs
its own contract against live Node; V8 microtasks stay out of its reach.

Twin of `node-eval-queued-exit-overrides-pending-fatal` (the fatal terminal, same deferral). Not a timing
tolerance: a fix ends the realm at the terminal (the isolate host's child sees no request then — ADR-0557 §6
removed a guest-reachable `done`) or stops rifty's dispatchers once the terminal exists (V8 microtasks stay a
ceiling).

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
