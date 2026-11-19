---
area: distribution
status: draft
title: Isolate host — an unhandled rejection followed by > 5 ms of synchronous work exits 0 with no diagnostic
created: 2026-11-19
why: A silent false success in merged code: Node exits 1 with the rejection's report; runCode exits 0, stderr empty.
user_story: As a service running model-generated code that rejects a promise and then computes for a few ms, I want Node's exit 1 and the error so the model can fix it, but today runCode reports a clean exit 0.
sources: [docs/public/compat/isolate-host.md, docs/backlog/runtime-js/node-eval-unhandled-rejection-timing.md, docs/backlog/runtime-js/late-unhandled-rejection-drain.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Finding (cross-review round 2 of PR #412, reproduced 2026-11-19, macOS arm64, Node v24.16.0, isolated-vm 7.0.2, branch
`t3/isolate-host-worker-pool` @ a67bdc4d9; the manager reports the same on main 6d7640353):

| `code` | `node -e` status | `runCode` |
|---|---|---|
| `Promise.reject(new Error('x')); const e = Date.now() + 10; while (Date.now() < e);` | 1 (diagnostic) | exit 0, stderr `''` |
| same with `+ 2` | 1 | exit 1, `[eval]` diagnostic |
| `Promise.reject(new Error('x'))` | 1 | exit 1, `[eval]` diagnostic |

Repro: `node -e "<code>"; echo $?` vs `node -e "import('./dist/index.js').then(async ({runCode}) => console.log(await runCode(process.argv[1])))" "<code>"` from `packages/isolate-host` after `pnpm run build`.

Not covered by a declared row. Compat ⚠️ "Unhandled rejection with other timers pending" says isolated-vm reports a rejection ~10 ms late and the failure lands at rifty's next drain check, but it needs other pending tasks, and its outcome is still exit 1. Here no task is pending and the rejection goes unreported. Hypothesis, unverified: the sync work delays isolated-vm's deferred `onUnhandledRejection` past the eval lifecycle's idle confirmation, so the drain ends before `rejection()` reaches the guest. Neighbours of the same mechanism: `runtime-js/node-eval-unhandled-rejection-timing` (handler from a later task; `fs.promises` chain) and `runtime-js/late-unhandled-rejection-drain` (an already-queued callback's `exit(0)`, browser path). This case has neither a later handler nor a queued callback. Open: does the custom embedder over `@riftydev/isolate-guest` (same `rejection` hook) share it?

## Challenge

challenge: 2026-11-19 — finding capture; no premise critic (README §Challenge)
