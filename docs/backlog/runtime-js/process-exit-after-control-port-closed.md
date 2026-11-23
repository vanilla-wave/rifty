---
area: runtime-js
status: draft
title: A process whose control port closed cannot exit — exit() throws "process exit requires an active control port"
created: 2026-11-22
why: Node's exit() always ends the process; rifty's port-backed process closes its control after a failed IPC post and then throws from exit(), so the guest sees a rifty-internal error instead of exiting.
sources: [docs/backlog/runtime-js/node-eval-work-queued-at-exit-runs.md]
code: [packages/runtime-js/src/builtins/process.ts]
---

## Context

PR #416 external review 2026-11-22 (real `MessageChannel`, kernel-style process spec): after `process.send(function)`
the post fails, `#closeControl()` marks the control closed, and a later `process.exit()` throws
`process exit requires an active control port`. `hasExitControl` (`process.ts`, `#ipcPort !== null`) keeps treating
the process as port-backed, as on main: the eval direct terminal fails loudly
(`install-process-ipc.test.ts` "routes a failed delayed eval exit control…"). Not reachable from `runCode` (port-less).
Node: `exit()` ends the process. Old defect of the port-backed path; owner runtime-js (ADR-0445 exit path).

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
