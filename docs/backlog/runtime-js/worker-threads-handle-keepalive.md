---
area: runtime-js
status: ready
title: A live `worker_threads.Worker` keeps the child event loop alive (counted handle)
created: 2026-09-15
why: the keepalive counts timers/immediates/pending imports (+ fetch, ADR-0158) only; a program whose only pending work is a running Worker drains and exits 0 before the worker's message (Node keeps the parent alive until the worker exits or is unref'd)
user_story: As a real CLI in the browser shell, I want my worker's later messages and exit event to reach me before the process ends, but today the parent drains and exits 0 while the Worker is still running
epic: vitest-run-in-browser
blocked_by: [runtime-js/process-lifecycle-events-exit-code]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/keepalive-residual-gaps.md, docs/backlog/runtime-js/worker-threads-kernel-run-to-completion-exit.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## User scenario

Goal I2: a Node program keeps running while a `worker_threads.Worker` it
created is alive: the parent receives the worker's later messages and its
`exit` event before the process ends (Node v24.16.0 oracle, host re-run
2026-10-05: `got hi`, `wexit 0` at 719 ms with no other handle; unref'd worker:
parent exits at its 50 ms timer, no late message). Today rifty drains at the
top-level resolve and exits 0 with no message (evidence §I2, main 51440931a).

## Context

`child_process` already takes a keepalive ref per spawned child
(`child_process.ts` `refEventLoop()`); `worker_threads.ts` takes none — the
drain's handle set (ADR-0152 + ADR-0158) misses the Worker class. The carrier
is a ref-counted handle in `Worker` itself (`refEventLoop`/`unrefEventLoop` at
start/finish, plus real `Worker.ref()/unref()` semantics), NOT a per-package
install patch (goal rejected route). An `unref()`'d worker must not hold the
loop, as in Node. The vitest-main question ("which handle does cac `start()`
await") stays map fog until the acceptance unit can actually run vitest
(`runtime-js/vitest-run-acceptance`); the handle model here is fixed by I2
regardless of which live Worker vitest ends up awaiting.

## Acceptance

1. A program whose only pending work is one live Worker stays alive: the
   worker's message posted at 700 ms is delivered and its `exit` event fires
   before the process ends; exit 0 (`→ I2`).
2. `worker.unref()` releases the hold: the parent exits at its own 50 ms timer
   and never sees the worker's later message (`→ I2`).
3. The ref releases when the worker exits (message + `process.exit(0)` inside
   the worker): the parent drains promptly after the `exit` event — no drain
   cap hang (`→ I2`).
4. `worker.ref()` re-acquires the hold after `unref()` (unit test on the handle
   state) (`→ I2`).

## Parity cases

Node v24.16.0 oracle (host run 2026-10-05, /tmp scripts): ref'd worker →
`got hi`, `wexit 0` at 719 ms; unref'd → parent exits at 50 ms. RED target:
`worker_threads/worker-keepalive.case.ts` (worker-env kind, fixed expected
string) — fails today on the rifty side: parent output stops after nothing
(drain exits 0 before the 700 ms message; `wexit` never printed).

## Out of scope

- `worker_threads` stdio streams and `execArgv: []` —
  `runtime-js/worker-threads-stdio-streams-empty-exec-argv` (after this unit).
- Kernel run-to-completion worker auto-exit divergence —
  `runtime-js/worker-threads-kernel-run-to-completion-exit` (the case's worker
  exits explicitly via `process.exit(0)`, which both realms deliver today).
- The vitest-main instrumented run — re-chart fog resolved at
  `runtime-js/vitest-run-acceptance`.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| leaked ref | worker exited (message + `process.exit(0)`), parent has no other handle | parent drains to natural exit, never hits the drain cap (`→ I3` loud-fail cap must not fire on a healthy tree) |
| over-hold | `worker.unref()`'d worker posting later | parent exits without the message; no output from the unref'd worker (`→ I2`) |

## Challenge

challenge: 2026-10-05 — clear — inherited goal §Challenge (2026-09-15, 6 problems resolved at FIT); oracle re-executed on host 2026-10-05 (ref/unref timing above)

## Decisions

- 2026-10-05 — agent (PICKUP): carrier = ref-counted Worker handle
  (`refEventLoop()` at start, release at `finish()`, user `ref()/unref()`
  flipping the same count) — an ADR-0152 handle-class extension, recorded as a
  dated §Corrections note on ADR-0152 (`DEC-2`; the drain hook contract itself
  is unchanged — the handle set grows, same as fetch ADR-0158).
- 2026-10-05 — agent (PICKUP): vitest-main instrumented run is infeasible
  before the acceptance unit (vitest cannot load yet); the fog question stays
  open at `runtime-js/vitest-run-acceptance`, which either observes the handle
  coverage or re-charts with a new child. I2's contract is the Worker class.
