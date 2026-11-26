---
area: runtime-js
status: draft
title: Outside a Node host an immediate queued inside an fs callback does not reliably run before a due 0 ms timer; Node runs the immediate first
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
does not hold the host's timers back. On main the guest's immediates were 1 ms timers (FIFO with its
timers, not Node's order).

## Question

Which turn order can a browser host give, and what would it cost? For example, a 0 ms timer due
after an fs callback could wait for the immediates queued before it. Not designed in PR #468.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
