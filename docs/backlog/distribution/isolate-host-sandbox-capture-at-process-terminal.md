---
area: distribution
status: draft
title: Capture a sandbox run's state at the process terminal, not after the realm runs what it already queued
created: 2026-11-23
why: A lead (manager, PR #419 round 4) that may close two declared ⚠️ divergences in one point — work queued at `process.exit()` and an `'exit'`-listener microtask after an explicit `exit()` both write files Node never writes.
sources: [ADR-0568, PR-419-external-review, docs/backlog/runtime-js/node-eval-work-queued-at-exit-runs.md, docs/backlog/distribution/isolate-host-natural-exit-listener-queued-work.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/isolate-host/src/child/main.ts]
---

## Context

Untried, narrowed 2026-11-23. Host-delivered callbacks (timers, `setImmediate`) after the run's
end no longer run (PR #424: the guest's run phase gates `fire`). Left: microtasks and callbacks
the realm runs before the run's status is out — a microtask queued at `process.exit()`, a
microtask an `'exit'` listener queues after `exit()`, a microtask or fs callback queued at an
uncaught throw, a timer due in the same turn as an `exit()` from a timer — still run and their
files are kept. Taking the snapshot at the process terminal (after the `'exit'` listeners,
before the queue drains) would leave those writes out, as in Node. Open questions: `finally`
blocks run while the exit signal unwinds; the memory held meanwhile; an endless microtask chain
after a throw is not cured by this (`isolate-host-uncaught-throw-waits-for-microtask-checkpoint`).
Not to be built before a probe. Owner: distribution (isolate host). Trigger: the first fix of a
remaining member, or a consumer finding a file written after `exit()`.

## Challenge

challenge: 2026-11-23 — none yet (factual capture, manager's lead)
