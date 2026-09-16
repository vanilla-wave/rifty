---
area: runtime-js
status: draft
title: A live `worker_threads.Worker` keeps the child event loop alive
created: 2026-09-15
why: the keepalive counts timers/immediates/pending imports (+ fetch, ADR-0158) only; a program whose only pending work is a running Worker drains and exits 0 before the worker's message (Node keeps the parent alive until the worker exits or is unref'd)
epic: vitest-run-in-browser
blocked_by: [runtime-js/process-lifecycle-events-exit-code]
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/keepalive-residual-gaps.md, docs/backlog/runtime-js/worker-threads-kernel-run-to-completion-exit.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/builtins/child_process.ts, packages/workbench/src/workers/node-program-lifecycle.ts]
---

## Context

Proven (rifty): `new Worker('./w.cjs')` whose worker posts after 700 ms →
parent exits 0 at 0.4 s, no message, no 'exit'. Oracle (Node v24.16.0, same
files): `got hi true`, `wexit 0`, `EXIT 0` — evidence §Oracle. `child_process`
already takes a keepalive ref for a spawned child (`child_process.ts:154`);
`worker_threads.ts` takes none. Contract = this handle class (goal I2).
Separately observed: the vitest CLI's `process.exit(0)` is issued by
`node-program-lifecycle.ts`'s natural-exit path while `start()` awaits; which
handle that wait is remains a map fog line — the instrumented run at pickup
confirms coverage or triggers a re-chart, it does not widen this item. The
vite-only `__riftyTrackCliPromise` install patch is not the carrier (goal
rejected route); the fix is a handle class in the keepalive, an ADR-0152
correction or a short ADR citing it.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P3 verified)
