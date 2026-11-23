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

Sandbox (ADR-0568): accepted as compat ⚠️ by the user 2026-11-23 (ADR-0568 §Not the user's words). Owner: distribution (isolate host). Trigger: the capture-at-terminal probe (`distribution/isolate-host-sandbox-capture-at-process-terminal`), or a sandbox consumer finding a file written by an `'exit'` listener's microtask.

PR #416 verify review 2026-11-22, `node -e` v24.16.0, natural exit (no `exit()`):

- `.then` chain a1→a2→a3 queued in an `'exit'` listener: Node all three, host `a1`; an async listener with three
  `await`s: Node `a b c d`, host `a b`.
- `process.exitCode = 6`, `exit(5)` or a throw in a listener-queued microtask, the first hop included
  (`Promise.resolve().then(() => process.exit(4))`: Node 4, host 0): Node 6 / 5 / 1 with the `[eval]:1` diagnostic;
  host 0, stderr empty (a throw via `queueMicrotask`: stderr `Error: L`). Same at `50c9d8bf1`. Since PR #421 the
  `queueMicrotask` throw prints the runtime's fatal report (`Error: L`, its `[eval]:1:55` frame, trailer; no header), status still 0 (`guest-seam.test.ts`).
- An `exit()` or throw inside a listener at a natural exit: the microtask queued before it still prints — the runtime
  does not report that the exit happened during `emit('exit')`, so the guest's output drop (`entry.ts`) keeps the
  natural-exit allowance. Corpus ceiling `exit-in-exit-listener-at-natural-exit-queued-microtask`.
- `process.nextTick` queued in a listener: Node prints nothing, host `nt` (same at `50c9d8bf1`).

Cause (first two): `child/main.ts` takes the status at the reaction to the guest's `run()` promise
(isolated-vm `result: {promise: true}`); that reaction is one hop into the guest's microtask queue, so later hops
run after the result is reported and their output and status are lost. The `nextTick` form: rifty runs the tick
queue from a microtask; Node's natural exit runs no tick queue after `'exit'`. Corpus ceilings
`exit-listener-microtask-chain-natural`, `exit-listener-microtask-exit-code-natural`,
`exit-listener-next-tick-natural` (`packages/isolate-host/tests/corpus.ts`, both lanes). The status of the first hop is
lost too: `settle()` reads it synchronously, before that hop. Fix direction: stop rifty's dispatchers after the
terminal, or let the host take the result only after the isolate's microtask checkpoint ends. Kernel children
(output of a listener microtask after `exit()`): not checked.

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
