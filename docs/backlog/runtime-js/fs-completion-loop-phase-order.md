---
area: runtime-js
status: draft
title: An fs completion does not take the loop phase Node gives it; the order against timers and immediates differs outside an fs callback on every host and inside one off the in-process host
created: 2026-11-26
why: "Node's loop orders poll (I/O callbacks) → check (immediates) → timers, so inside an fs callback `setImmediate` beats `setTimeout(0)` even once the timer is due — a documented guarantee; Workbench and SDK run the due timer first"
sources: ["PR #468 external review (manager-relayed, 2026-11-26)", tools/node-parity-runner/cases/fs/callback-phase-order.case.ts]
code: [packages/runtime-js/src/builtins/timers.ts]
---

## Context

Program: `tools/node-parity-runner/cases/fs/callback-phase-order.case.ts` (each line: inside an fs
callback, `setTimeout(…, 0)`, `setImmediate`, 3 ms busy; and the next `stat` beside immediates and
timers queued before and after it). Node v24.16.0: 240/240 `immediate,timeout` and
`immediate<,immediate>,timeout<,timeout>,cb`. Measured 2026-11-26, Chromium (Playwright), 2 runs per
host, throwaway carrier specs:

| line | main `c2250727d`, Workbench / SDK | PR #468, Workbench / SDK |
|---|---|---|
| `readFile`/`stat`/`read` callback: timer, immediate | `timeout,immediate` | `timeout,immediate` |
| `promises.readFile` callback: timer, immediate | `immediate,timeout` | `timeout,immediate` |
| the next `stat` beside them | `cb,immediate<,timeout<,timeout>,immediate>` | `timeout<,timeout>,immediate<,immediate>,cb` |
| cleared immediate, timer, nested | `first,timer,nested` (= Node) | `first,timer,nested` (= Node) |

rifty's immediates and fs turns are `MessageChannel` tasks there. Chromium ran the due timer task
before them, so the browser hosts have no check phase ahead of timers. In-process (a Node host,
PR #468) gives Node's lines.

Isolate, PR #468, 8 runs: each line is Node's in 5–7 runs, else a timer first (`timeout,immediate`,
`immediate<,timeout<,immediate>,timeout>,cb`). The cleared-immediate line was 8/8. The guest runs on
the isolate's thread beside the host loop. The host's 1 ms timers and its `setImmediate` deliveries
(the bridge's 0 ms `timerStart`) are queued into the isolate as they come due, so a guest busy wait
does not hold the host's timers back. The same race moves a due timer after a completion in `fs/callback-turn-order`
on CI (PR #468 run 45765007596: `stat`, `read EBADF`, `promises.readFile` `after: timeout<,timeout>`); the
isolate test compares that case without the timers. On main the guest's immediates were 1 ms timers (FIFO with its
timers, not Node's order).

Outside an fs callback, 2026-11-26 (PR #468 second external review; Node v24.16.0 300/300). Program
`/tmp/xr468-r2-ord/ph3.js` of the review: `setTimeout(T, 0)`, `fs.stat(cb)`, `setImmediate(I)`, 3 ms busy,
queued from the context named; and `top.js`: top-level `readFile` + `setImmediate` + busy.

| context | Node | in-process (PR #468) | isolate (PR #468, 4 runs) |
|---|---|---|---|
| in an immediate | `T,cb,I` | `T,I,cb` | `I,T,cb` 3, `T,I,cb` 1 |
| in a timer | `cb,I,T` | `I,T,cb` / `I,cb,T` (racy; main was = Node) | `I,T,cb` |
| in an fs callback | `I,T,cb` | `I,T,cb` (= Node, `fs/callback-phase-order`) | `I,T,cb` |
| top level | `cb,I` (198/200) | `I,cb` | `I,cb` |

The operation takes a check-phase immediate in every context, so a call made outside a completion
waits an extra loop turn. Probed in PR #468, not taken: a call made outside an `ioTurn` completion
posts its completion message at the call and runs its operation in that turn (one turn). That gave
Node's four lines in-process, but it broke the pinned `fs/dir-read-turns` row «reads an immediate came
before» (`33,41` → empty): a call made from a `nextTick` in the poll phase is drained by the same
`MessagePort` pass.

## Question

Which turn order can each host give, and at what cost? A loop-phase model (poll → check → timers) in
the runtime is one direction, not designed in PR #468; the probe above is another.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
