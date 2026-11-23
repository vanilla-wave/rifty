---
area: runtime-js
status: draft
title: A guest `unhandledrejection` listener's `preventDefault()` is ignored while a guest-cancelled global `error` stays nonterminal
created: 2026-11-23
why: one guest act, two answers — a cancelled uncaught error stays nonterminal (ADR-0340), a cancelled rejection still ends the process — on a Worker-global surface Node does not have
sources: [docs/adr/kernel/0340-sequenced-worker-stdio-reconstructs-cross-port-write-order.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/backlog/runtime-js/guest-browser-only-globals.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/ipc/no-coi-child-worker.ts, packages/workbench/src/workers/no-coi-toolchain-owner.ts, packages/workbench/src/workers/kernel-worker-entry.ts]
---

## Context

PR #421 external review, round 4: observed by the review, not reproduced here
(no browser run in this capture). Below is code reading of
`event-loop-keepalive.ts` with the ADR-0445 2026-11-23 rollback applied (the
error trap is main's again); the rejection trap's order is main's too (PR #421
only changed the reason passed to the `-e` claim).

Program in a browser Worker realm — no-COI SDK `project.run` `node`, a no-COI
child Worker, a COI kernel child:
`globalThis.addEventListener('unhandledrejection', (e) => e.preventDefault()); Promise.reject(new Error('x'))`.

- rifty, rejection: `installEventLoopKeepalive()` registers rifty's trap at
  realm boot (`no-coi-toolchain-owner.ts`, `no-coi-child-worker.ts`,
  `kernel-worker-entry.ts`), before any guest listener. No `process` listener →
  `-e`: `beginNodeEvalUnhandled` claims the terminal; a file entry:
  `terminateFatal` writes the report, requests exit 1 and rifty cancels the
  event itself. The guest's later `preventDefault()` has no effect: report,
  exit 1.
- rifty, uncaught error: a file entry's throw is dispatched (no listener →
  `beginFatal`: `exitCode = 1`, `'exit'` 1), then rifty's `error` trap leaves
  the event uncancelled and the browser's Worker error report ends it — a COI
  kernel child or no-COI child Worker exits; a no-COI project command crashes
  the toolchain Worker (`failed`, `Worker crashed: Uncaught Error: …`, Worker
  replaced, `distribution/no-coi-command-unhandled-rejection-exit`). A guest `preventDefault()` (or `onerror` returning true) cancels that report,
  and a canceled global error stays nonterminal (ADR-0340; ADR-0445 2026-11-23
  rollback line). What the run does next — later timers, status — is unprobed.
- Node v24.16.0: no oracle for the cancel — the global listener API is absent:
  `node -e "globalThis.addEventListener('unhandledrejection', (e) => e.preventDefault()); Promise.reject(new Error('x'))"`
  → `TypeError: globalThis.addEventListener is not a function`, exit 1
  (`typeof globalThis.addEventListener` → `'undefined'`).
- Isolate host: not reachable — the guest context has no `addEventListener`
  global and rejections arrive through isolated-vm (`rejection()` in
  `isolate-guest` `entry.ts`), never as an event.

Fault class: `sibling-drift` (two realm-error paths, one guest act) on a
Node-absent surface; the surface itself is `runtime-js/guest-browser-only-globals`.
Across commands of one no-COI sandbox the same listeners persist:
`distribution/no-coi-node-process-realm`.

Compat: no row names either path's guest-cancel behavior (`process.md`); add a
⚠️ row linking this draft with the fix or the decision.

## Question

Which single answer do both paths give a guest cancel?

- (a) hide/throw the guest-visible `addEventListener`/`onerror`/
  `onunhandledrejection` as Node does — settles both; decided in
  `runtime-js/guest-browser-only-globals` (rifty's own boot listens on the
  Worker global, so hiding needs its own seam);
- (b) the rejection trap honors a guest cancel as the error path does;
- (c) a guest cancel of a global error stops being nonterminal (Node has no
  cancel; ADR-0340's line then needs a dated correction).

owner: agent — whose cancel ADR-0340's "canceled global errors remain
nonterminal" protects (rifty's own lifecycle vs any guest listener), read from
the ADR's seam and its carrier, decides between (b) and (c); (a) depends on the
browser-globals policy.

Acceptance target at pickup: one browser carrier per reachable realm (no-COI
`tests/no-coi/` project command and child Worker, COI `tests/browser-unit/`)
runs a cancelling guest listener against a throwing `setTimeout` and against
`Promise.reject`, both as a file entry; both outcomes (stderr, status, whether
later timers run) equal the chosen answer and each other, with the Node
artifact above as the reference row; the no-COI project-command row waits on
`distribution/no-coi-command-unhandled-rejection-exit` (an uncancelled throw
there crashes the Worker today).

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
