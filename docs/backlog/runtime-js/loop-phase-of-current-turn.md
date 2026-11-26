---
area: runtime-js
status: draft
title: "Event-loop phase order: what rifty knows of the current turn — off the in-process host, and where Node races, fs completions and immediates take orders Node does not give"
created: 2026-11-26
why: "Node orders a loop turn poll (I/O callbacks, messages, sockets) → check (immediates) → timers, and an fs call takes one threadpool round trip to the next poll; rifty knows only its own turns (timer, immediate, I/O completion, main module), so where the turn is foreign or the host has no phases the order differs from Node's"
sources: ["PR #468 external reviews 1–3 (manager-relayed, 2026-11-26)", tools/node-parity-runner/cases/fs/callback-phase-order.case.ts]
code: [packages/runtime-js/src/builtins/timers.ts, packages/runtime-js/src/builtins/fs-io-turn.ts]
---

## Context

Groundwork for a separate "loop-phase model" unit. PR #468 (`ioTurn`): every fs call takes two
turns — an operation turn (an immediate), then its completion (a Node host's `MessagePort`, its
poll; elsewhere the immediate queue). rifty does not know which phase the current turn is. Where
Node races (an immediate pending, poll does not wait for the pool: a call from a timer, an
immediate, the main module), two turns are Node's "pool missed the poll" order; elsewhere they are
Node's only order. Guest-code entries rifty cannot tell apart (turns it does not own): `MessagePort`
messages, `worker.on('message')`, sockets / HTTP, IPC (`process.on('message')`), host-resolved
promises (a host API's `then`, `fetch`).

Tried in PR #468 and dropped (manager decision (b), 2026-11-26), so no next executor repeats it:
a "not poll" flag in `timers.ts` — one I/O turn queued at the call when the call is made in rifty's
own timer turn, immediate turn or the main module's run. It rested on b1 «fs.read callback vs a
timer due now» being a deterministic Node row; Node races it (Acceptance 2 of
`runtime-js/fs-callbacks-io-turn`). Its costs: the flag leaked into foreign turns that followed a
raise (one-turn completions where Node takes two: tables below); `fs.write(fd, 'data', cb)` +
`Promise.reject` gave `cb` on Workbench/SDK/isolate (two turns: Node's `""`); clearing it by a host
task posted on the immediates' `MessageChannel` broke the pinned no-COI row
`setImmediate(log); Promise.resolve().then(() => process.exit(3))` (run `failed`, 8/8; a
`setTimeout(0)` clear passed it, not investigated). Commits `358cd3612`, `b180494eb`, `e6a69be6a`
(never pushed; the PR body keeps their diffs' summary).

All rows Node v24.16.0. Measured 2026-11-26, Chromium (Playwright) via throwaway carrier specs,
isolate `runCode`, in-process the parity runner.

### Inside an fs callback (`fs/callback-phase-order`)

Each line: in an fs callback `setTimeout(…, 0)`, `setImmediate`, 3 ms busy; and the next `stat`
beside immediates and timers queued before and after it. Node 240/240 under load (8 parallel).

| line | Node | main `c2250727d`, Workbench / SDK | PR #468, Workbench / SDK |
|---|---|---|---|
| `readFile`/`stat`/`read` callback: timer, immediate | `immediate,timeout` | `timeout,immediate` | `timeout,immediate` |
| `promises.readFile` callback: timer, immediate | `immediate,timeout` | `immediate,timeout` | `timeout,immediate` |
| the next `stat` beside them | `immediate<,immediate>,timeout<,timeout>,cb` | `cb,immediate<,timeout<,timeout>,immediate>` | `timeout<,timeout>,immediate<,immediate>,cb` |
| cleared immediate, timer, nested | `first,timer,nested` | = Node | = Node |

rifty's immediates and fs turns are `MessageChannel` tasks on the browser hosts; Chromium ran the
due timer task first: no check phase ahead of timers. In-process (a Node host) = Node.

Isolate, PR #468, 8 runs: each line Node's in 5–7 runs, else a timer first (`timeout,immediate`,
`immediate<,timeout<,immediate>,timeout>,cb`); cleared-immediate line 8/8. The guest runs on the
isolate's thread beside the host loop; the host's 1 ms timers and `setImmediate` deliveries (the
bridge's 0 ms `timerStart`) are queued into the isolate as they come due, so a guest busy wait does
not hold the host's timers back. Same race in `fs/callback-turn-order` on CI (run 45765007596:
`stat`, `read EBADF`, `promises.readFile` `after: timeout<,timeout>`); the isolate test compares that
case without timers. On main the guest's immediates were 1 ms timers.

### Outside an fs callback, and b1 (Node races)

`setTimeout(T, 0)`, `fs.stat(cb)`, `setImmediate(I)`, 3 ms busy, from the context named; main
module: `fs.stat(cb); setImmediate(I)`; b1: its row (`b1-bindings.cjs`). Node v24.16.0, 300 processes
each, macOS: "alone" no own load (other sessions: load 4–25), "load" 16 parallel + 8 CPU burners
(load 25–39). rifty at PR #468 head (two turns): in-process / isolate 30 processes, Workbench / SDK
30 runs (b1 10). Bold: an order Node never gave.

| row | Node alone | Node load | in-process | isolate | Workbench / SDK |
|---|---|---|---|---|---|
| in an fs callback | `I,T,cb` 300 | 300 | `I,T,cb` 30 | `I,T,cb` 29, **`T,I,cb`** 1 | **`T,I,cb`** 30 |
| in an immediate | `T,cb,I` 298, `T,I,cb` 2 | `T,cb,I` 300 | `T,I,cb` 30 | **`cb,I,T`** 30 | `T,I,cb` 30 |
| in a timer | `cb,I,T` 296, `I,T,cb` 4 | `cb,I,T` 300 | `I,T,cb` 30; in the case **`I,cb,T`** 26/30 | `cb,I,T` 26, **`cb,T,I`** 3, **`T,cb,I`** 1 | **`T,I,cb`** 30 |
| main module | `cb,I` 289, `I,cb` 11 | `cb,I` 284, `I,cb` 16 | `I,cb` 30 | `cb,I` 30 | `I,cb` 30 |
| b1 | `timer,read cb,immediate` 284, else `timer,immediate,read cb` | 276 | `timer,immediate,read cb` 30 | `timer,read cb,immediate` 10 | `timer,immediate,read cb` 10 |

Linux CI, b1: 35/36 `timer,read cb,immediate` (PR #471 run 45788011611). Pinned: «in an fs callback»
(in-process, `fs/callback-phase-order`); «in an immediate» and «main module» there as «an order
Node gives»; «in a timer» not (in-process `I,cb,T`); b1 in the streams carrier as a Node race.
Under the dropped flag (one turn from timer/immediate/main module): in-process = Node's majority
order on the first four rows (review round 3), isolate main module `cb,I` 30/30.

### Foreign turns: messages, workers, HTTP

Program `/tmp/fsturn/entries/entries.cjs` (in the PR #468 body): the entry's handler runs
`setTimeout(T, 0)`, `fs.stat(cb)`, `setImmediate(I)`, 3 ms busy; the message / request was sent
from the context named. 30 runs per row. Node: every row `I,T,cb` 30/30. A `358cd3612` (one turn
outside a completion), B `b180494eb` (flag + clearing task), C `e6a69be6a` (flag alone): all
dropped; D head (two turns). In-process port rows `I,T,cb` 30/30 = Node (A, C, D). Workbench /
SDK the same unless noted.

| entry, sent from | A | B | C | D |
|---|---|---|---|---|
| port message, timer | `T,cb,I` | `T,I,cb` | `T,cb,I` | `T,I,cb` |
| port message, fs callback | `T,I,cb` | `T,I,cb` | `T,I,cb` | `T,I,cb` |
| port message, immediate | `T,cb,I` | `T,cb,I` | `T,cb,I` | `T,I,cb` |
| worker message, timer (Workbench; SDK no Worker) | `T,cb,I` | `T,I,cb` | `T,cb,I` | `T,I,cb` |
| worker message, fs callback | `T,I,cb` | `T,I,cb` | `T,I,cb` 28, `T,cb,I` 2 | `T,I,cb` |
| worker message, immediate | `T,cb,I` | `T,I,cb` | `T,cb,I` | `T,I,cb` |
| HTTP request, timer | `cb,I,T` 28, `T,cb,I` 2 | same | same | `I,cb,T` 28, `T,I,cb` 2 |
| HTTP request, fs callback | `T,I,cb` | `T,I,cb` | `T,I,cb` | `T,I,cb` |
| HTTP request, immediate | `T,cb,I` | `T,cb,I` | `T,cb,I` | `T,I,cb` |

Isolate: no `MessageChannel`, Worker or `http` server in the guest. No browser row equals Node: the
timer runs first (no check phase); `cb` before `I` (A–C) is a one-turn completion in a foreign
turn; D's HTTP-from-timer `I,cb,T` (Node never) not analysed.

## Question

Which turn order can each host give, at what cost? A loop-phase model (poll → check → timers) in
the runtime, telling every entry above apart, is one direction, not designed in PR #468.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
