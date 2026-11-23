---
area: distribution
status: draft
title: Capture a sandbox run's state at the process terminal, not after the isolate drains its queue
created: 2026-11-23
why: A lead (manager, PR #419 round 4) that may close two declared ⚠️ divergences in one point — work queued at `process.exit()` and an `'exit'`-listener microtask after an explicit `exit()` both write files Node never writes.
sources: [ADR-0568, PR-419-external-review, docs/backlog/runtime-js/node-eval-work-queued-at-exit-runs.md, docs/backlog/distribution/isolate-host-natural-exit-listener-queued-work.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/isolate-host/src/child/main.ts]
---

## Context

Untried. Today the run's end state is captured after the isolate's run returns,
i.e. after the queue drained, so a file written by work that runs after the
process's terminal (`process.exit()` with work already queued; a microtask from
an `'exit'` listener after an explicit `exit()`; a fatal with work queued) stays
in the state. Taking the snapshot at the process terminal — after the `'exit'`
listeners, before the isolate finishes its queue — would leave those writes out,
as in Node, where no process exists at that point. Open questions: `finally`
blocks run while the exit signal unwinds; the memory held during the drain; the
uncaught-throw-plus-endless-microtask-chain divergence
(`isolate-host-uncaught-throw-waits-for-microtask-checkpoint`) is not cured by
this (the isolate never leaves the checkpoint). Not to be built before a probe. Owner: distribution (isolate host). Trigger: the first fix of either divergence it may cover.

## Challenge

challenge: 2026-11-23 — none yet (factual capture, manager's lead)
