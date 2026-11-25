---
area: runtime-js
status: draft
title: A Worker that posts two messages and returns intermittently delivers only the first before 'exit' in Chromium
created: 2026-11-25
why: ADR-0446 §5 ends the kernel record after every earlier message (Node delivers both before 'exit'); one CI run lost the second message, a runtime delivery-order race: the row is assembled inside the guest
user_story: As a developer whose worker script posts results and ends, I want every posted message delivered before 'exit' as in Node, but today one Chromium run delivered `first` and then `exit` without `second`
sources: [docs/public/compat/process.md, docs/adr/runtime-js/0446-count-live-worker-threads-workers-in-child-realm-keepalive.md, tools/node-parity-runner/cases/worker_threads/worker-natural-exit.case.ts, tests/browser-unit/worker-handle-keepalive.spec.ts]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/workbench/src/workers/node-entry-bootstrap.ts]
---

## Context

Observed once: CI run 45525442020 attempt 1 (PR #445, HEAD `ddae6c8b9`, Chromium
148.0.7778.96, job browser-unit-chromium),
`tests/browser-unit/worker-handle-keepalive.spec.ts:39` row `worker-natural-exit`:

- expected (live Node v24.16.0 oracle):
  `WT|w-return.cjs message:first message:second exit:0 after-exit:null,null,undefined,undefined`
- got: `WT|w-return.cjs message:first exit:0 after-exit:null,null,undefined,undefined`

`w-return.cjs` requires `node:worker_threads` and runs
`parentPort.postMessage('first'); parentPort.postMessage('second');` (parity case
`worker_threads/worker-natural-exit`); the other three rows of the same run matched.
The row is built in the guest: the parent's `'exit'` listener joins `rows` and
one `console.log` prints them after `Promise.all` — so in the guest realm
`'exit'` was emitted before the second `'message'`; a truncated stdout cannot
drop a middle token while `exit:0`/`after-exit` remain. Contradicts compat
`process.md` «Worker-thread natural exit ✅ … its messages reach the parent
before the parent's `'exit'`» and ADR-0446 §5 (the control port ends the kernel
record after every earlier message; owner: `node-entry-bootstrap.ts`).

Attempt 2 of the same run passed; locally on macOS
`playwright test --config playwright.browser-unit.config.ts tests/browser-unit/worker-handle-keepalive.spec.ts --repeat-each=6 --workers=2`
→ 6/6 passed. PR #445 changes no runtime source (build/notices tooling only);
browser-unit runs the runtime from source.

Open: where the order breaks (control-port end vs. queued `parentPort`
message delivery in `worker_threads.ts` / `node-entry-bootstrap.ts`) and the
repro rate — not determined. The CI run was sequential (`Running 392 tests
using 1 worker`); host load is not shown.

## Challenge

challenge: 2026-11-25 — clear — factual capture (README §Challenge: no premise critic)
