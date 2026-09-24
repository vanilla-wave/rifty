---
area: runtime-js
status: draft
title: Unhandled rejection vs an already-queued Node callback — the callback runs first and its exit(0) wins
created: 2026-08-02
why: Chromium delivers `unhandledrejection` in its own later task, so a Node callback already queued (setImmediate, same-due timers, fs callback, fs.promises settlement) runs before it; with no listener its `exit(0)` exits 0 with no stderr where Node prints the error and exits 1
user_story: As a Node program with an unhandled rejection followed by an already-queued callback that calls `process.exit(0)`, I want Node's stderr and exit 1, but today the callback runs first and the program exits 0 silently.
sources: [docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md, docs/backlog/runtime-js/process-lifecycle-events-exit-code.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/adr/perf/0085-setimmediate-queue-rep-check-phase-drain-order-contract.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/npm-client/reference/sass-embedded-contract-red.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/timers.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts]
---

## Context

Finding. First captured 2026-08-02 (Sass substitution slice) as a drain race:
`awaitDrain` settled on its first zero-ref sample before Chromium dispatched a
detached rejection's `unhandledrejection` task → silent exit 0. ADR-0445 rule 7
closes that race (unit `runtime-js/process-lifecycle-events-exit-code`: one
more host task confirms zero refs; carriers
`event-loop-keepalive-late-rejection.fault.test.ts`, browser-unit
`fatal-rejection`, `rejection-only-handler`). This draft now owns the case that
unit put Out of scope (user fork 2026-09-24): a Node callback already queued
that runs before Chromium's `unhandledrejection` task. Compat ⚠️ row
"`unhandledRejection` vs an already-queued Node callback"
(`docs/public/compat/process.md`).

Evidence (process-lifecycle evidence §F2): Node v24.16.0 `node <f>.cjs` ×3;
rifty = real Chromium browser-unit probe, `node <f>.cjs` in the shell, 3/3 @
`91f6fa4e1`. Each program starts
`process.on('exit', (c) => console.log('L|exit', c, process.exitCode));`

| program | Node | rifty |
|---|---|---|
| `Promise.reject(new Error('I1')); setImmediate(() => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('F1')); fs.readFile(__filename, () => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('F3')); fs.stat(__filename, () => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('S3')); fs.promises.readFile(__filename).then(() => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `setTimeout(() => { Promise.reject(new Error('S1')) }, 1); setTimeout(() => process.exit(0), 1)` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `setImmediate(() => { Promise.reject(new Error('S2')) }); setImmediate(() => process.exit(0))` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `setTimeout(() => { Promise.reject(new Error('T1')); setImmediate(() => process.exit(0)) }, 1)` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `fs.readFile(__filename, () => { Promise.reject(new Error('S5')); setImmediate(() => process.exit(0)) })` | `L\|exit 1 1`, stderr, 1 | `L\|exit 0 0`, no stderr, 0 |
| `Promise.reject(new Error('I2')); setImmediate(() => console.log('L\|after'))` | `L\|exit 1 1`, stderr, 1 | `L\|after`, `L\|exit 1 1`, stderr, 1 |
| listener prints `L\|rej`; `Promise.reject(new Error('S4')); setImmediate(() => console.log('L\|imm'))` | `L\|rej S4`, `L\|imm`, 0 | `L\|imm`, `L\|rej S4`, 0 |
| control: `Promise.reject(new Error('V1')); setTimeout(() => process.exit(0), 1)` | `L\|exit 1 1`, stderr, 1 | same |

Mechanism. Node runs `runNextTicks()` (microtasks, then
`processTicksAndRejections` while a rejection is pending) before each timer and
each immediate (`processTimers`/`processImmediate`, evidence §F2), so a
no-listener rejection is fatal before the next callback. Chromium queues
`unhandledrejection` as its own task after the task that made the rejection;
a callback queued before it runs first: an immediate's `MessageChannel`
message posted in the same turn, a timer ripe at the same time, an fs
callback (rifty runs it as a promise reaction in the same task —
`runNodeCallback`), a `fs.promises` settlement. ADR-0445 rule 3's trap-time
terminal is correct once the trap runs; the trap cannot run earlier.

## Options

- **Rejection fence** (the only order-true route found): run each Node
  callback — timer, immediate, fs/I/O callback, `fs.promises` settlement — in a
  host task posted after the previous callback's task ended and Chromium's
  rejection task for it ran. Costs, by design reasoning (not executed): ≥ 2
  host-task hops per callback (the notification is queued at the end of the
  callback's task, after its microtasks, so a task posted from inside that
  task can still precede it); `setImmediate` loses its lead over a same-turn
  `setTimeout(0)` (ADR-0085 guarantee 2) unless the fence keeps the check-phase
  order itself; every `fs.promises` result settles a task later. Unverified:
  Chromium's order between a posted message and its rejection task (different
  task sources).
- Killed (ADR-0445 §Alternatives): synchronous tracking by patching `Promise`
  (native async-function rejections bypass it); a fixed delay (a timing
  guess, not an order).

Owner: runtime-js — the Node callback schedulers (`builtins/timers.ts`,
`runNodeCallback` in `builtins/process-lifecycle-events.ts`, fs/`fs.promises`
settlement) and the realm `unhandledrejection` trap
(`internal/event-loop-keepalive.ts`). Trigger: a real program on a claimed path
whose status or output is wrong because a queued callback ran before its
rejection (a test runner or CLI exiting 0 after a fatal rejection), or a goal
that claims Node's rejection-before-next-callback order. Until then a capture,
not an obligation.

Dedup: `process-lifecycle-events-exit-code` claims rejections Chromium has
already delivered and names this case Out of scope;
`invocation-scoped-unhandled-rejection` scopes a recorded rejection to one
no-COI invocation; `same-realm-child-async-throw-ownership` concerns fallback
callback exceptions; `worker-threads-kernel-error-event` concerns the parent
`'error'` after a loud exit. None owns callback order against Chromium's
rejection task.
