---
area: runtime-js
status: draft
title: node -e — an exit() queued before the eval terminal completes overrides an uncaught throw or rejection
created: 2026-11-18
why: Node ends the process inside its fatal handler; rifty's eval lifecycle claims the terminal (`beginNodeEvalUnhandled`) but completes it on the drain's next tick, so a timer or microtask already queued runs first and its `process.exit(0)` reads as a clean run.
sources: [docs/public/compat/isolate-host.md, docs/backlog/runtime-js/late-unhandled-rejection-drain.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Isolate host (ADR-0557) @ 264e4b894 against `node -e` v24.16.0, each Node
exit 1 with the `Error: x` report, host `{stdout: '', stderr: '', exitCode: 0}`:
`setTimeout(() => { throw new Error('x') }); setTimeout(() => process.exit(0))`;
`setTimeout(() => { queueMicrotask(() => process.exit(0)); throw new Error('x') })`;
`Promise.reject(new Error('x')); setTimeout(() => process.exit(0))`.
Landing verify @ 9269eb909 widened the class: a queued `exit(3)` gives 3; any
queued callback still runs and prints (`console.log('second')`, Node prints
nothing); an `'exit'` listener sees 1 while the status ends 0; exits from
`process.nextTick` and fs callbacks read as a clean 0 too.
`beginNodeEvalUnhandled` records `pendingTerminal` and returns while a drain
owns the run; the next queued callback's `exit(0)` becomes the terminal. The
browser `node -e` path shares the lifecycle (unprobed there); the sibling
`late-unhandled-rejection-drain` is the same outcome through Chromium's
`unhandledrejection` task. Pinned in `packages/isolate-host/tests/parity.test.ts`. 2026-11-22 (PR #416): a microtask an `'exit'` listener
queues on a fatal still prints (corpus ceiling `exit-listener-microtask-after-fatal`).

2026-11-23, PR #421 external review round 4 (isolate host; observed by the
review, not reproduced here): output of work the throwing callback queues also
prints (an in-callback `queueMicrotask(() => process.exit(0))` above already
showed it runs) —
`setTimeout(() => { process.nextTick(() => console.log('tick')); Promise.resolve().then(() => console.log('then')); throw new Error('x') })`
prints both. Node v24.16.0 (`node -e` and `node q.js`): the report, exit 1,
neither printed; `fs.writeFileSync` in them leaves no file. Compat
isolate-host.md "Work already queued when an uncaught throw or unhandled
rejection happens" already names `nextTick` and microtasks. Fault class:
`observable-order` (the terminal is claimed, the realm runs on). Who
dispatches (code reading): `nextTick` callbacks run in rifty's `drainNextTicks`
(`process.ts`, one queued microtask); `.then` callbacks run inside rifty's
`patchPromiseForNextTick` wrapper (installed in the guest by
`installProcessGlobals`); the guest's `queueMicrotask` is rifty's shim
(`isolate-guest` `web-shim.ts`, its own `run` wrapper); bare V8 jobs of the
same checkpoint are `await`/async-function continuations and reactions not made
through the patched `.then`
(`distribution/isolate-host-uncaught-throw-waits-for-microtask-checkpoint`).
Open question, owner: agent — the stop mechanism (a terminal check in rifty's
dispatchers vs ending the isolate at the fatal; what stays a ceiling) needs a
spike. No corpus row has in-callback `nextTick`/`then`
(`fatal-with-queued-in-callback` = timer + immediate). Acceptance target: that
row in `tests/browser-unit/fixtures/node-file-programs.ts` against live Node,
with per-host pins (`node-file-pins.json`) for no-COI, COI and isolate — the
no-COI/COI outcome is unprobed — and an `-e` row in
`packages/isolate-host/tests/parity.test.ts`.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
