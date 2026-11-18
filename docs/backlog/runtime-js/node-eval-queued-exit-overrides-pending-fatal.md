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
`unhandledrejection` task. Pinned in `packages/isolate-host/tests/parity.test.ts`.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
