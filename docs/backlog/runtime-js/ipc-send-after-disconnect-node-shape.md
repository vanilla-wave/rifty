---
area: runtime-js
status: draft
title: IPC `send()` after disconnect does not match Node — no async `ERR_IPC_CHANNEL_CLOSED` `'error'`; a same-realm child's `process.send()` after `process.disconnect()` returns `true` and delivers
created: 2026-09-23
why: Node reports a send on a closed channel (`false` + async `'error'`, nothing delivered); rifty stays silent on both routes and, on the same-realm route, still delivers
sources: [docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md, docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-final-green.json]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

REV-12 discoveries of `runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md`
(contract Decisions; evidence §Oracle — process-boundary faults; Node
v24.16.0), both serializations:

- parent `send()` after the child exited: Node returns `false` and emits an
  async `ERR_IPC_CHANNEL_CLOSED` `'error'` on the ChildProcess; rifty returns
  `false`, no `'error'` (`child_process.ts:182`).
- same-realm child `process.send()` after `process.disconnect()`: Node
  `false`, nothing delivered; rifty `true` and the parent receives it
  (`child_process-exec.ts:337`; scratch parity probe, default JSON).

## Next

Owner runtime-js; trigger: a consumer that sends on a closed channel and
branches on `'error'`/return value, or the next IPC unit. Parity cases
(`child-worker` + same-realm) first.
