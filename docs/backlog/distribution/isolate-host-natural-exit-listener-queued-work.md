---
area: distribution
status: draft
title: Isolate host — at a natural exit only the first microtask hop an 'exit' listener queues counts
created: 2026-11-22
why: Node runs what its 'exit' listeners queue at a natural exit to the end (output and status); the isolate host reports the run at the run promise's reaction, so later hops neither print nor set the status, and a queued nextTick prints where Node runs none.
sources: [docs/public/compat/isolate-host.md, docs/backlog/runtime-js/node-eval-work-queued-at-exit-runs.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

PR #416 verify review 2026-11-22, `node -e` v24.16.0, natural exit (no `exit()`):

- `.then` chain a1→a2→a3 queued in an `'exit'` listener: Node all three, host `a1`; an async listener with three
  `await`s: Node `a b c d`, host `a b`.
- `process.exitCode = 6`, `exit(5)` or a throw in a listener-queued microtask: Node 6 / 5 / 1 with the diagnostic;
  host 0, stderr empty. Same at `50c9d8bf1`.
- `process.nextTick` queued in a listener: Node prints nothing, host `nt` (same at `50c9d8bf1`).

Cause (first two): `child/main.ts` takes the status at the reaction to the guest's `run()` promise
(isolated-vm `result: {promise: true}`); that reaction is one hop into the guest's microtask queue, so later hops
run after the result is reported and their output and status are lost. The `nextTick` form: rifty runs the tick
queue from a microtask; Node's natural exit runs no tick queue after `'exit'`. Corpus ceilings
`exit-listener-microtask-chain-natural`, `exit-listener-microtask-exit-code-natural`,
`exit-listener-next-tick-natural` (`packages/isolate-host/tests/corpus.ts`, both lanes).

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
