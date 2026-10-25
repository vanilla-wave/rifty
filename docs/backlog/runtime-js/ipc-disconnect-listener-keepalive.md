---
area: runtime-js
status: draft
title: Fork child IPC keepalive ignores a `'disconnect'`-only listener; same-realm parent `disconnect()` leaves a listening child held
created: 2026-09-23
why: Node holds a fork child's channel for a `'disconnect'` listener and releases every hold on parent disconnect; rifty counts only `'message'` and, same-realm, keeps the hold after disconnect
sources: [docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md, docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-final-green.json]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

REV-12 discoveries of `runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md`
(contract Decisions; evidence §Keepalive; Node v24.16.0), both
serializations:

- a child with only `process.on('disconnect', …)` stays alive until the
  parent disconnects (Node `alive-after-300ms true true`, then
  `child-disconnect`, exit 0); rifty's `#syncIpcKeepalive` runs for
  `'message'` only (`process.ts:662-680`), so the child exits early.
- same-realm route: parent `disconnect()` leaves a `'message'`-listening
  child's hold in place (Contract+RED r1 reviewer probe).

vitest 4.1.11's pool child uses neither shape.

## Next

Owner runtime-js; trigger: a fork child that waits only on `'disconnect'`,
or the next IPC keepalive unit. Parity case (both routes) first.
