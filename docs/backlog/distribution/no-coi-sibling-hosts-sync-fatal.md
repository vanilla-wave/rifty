---
area: distribution
status: draft
title: "No-COI runBin and SW-backed child processes print a synchronous fatal throw's report and exit with Node's status"
created: 2026-11-18
why: the project command runs the runtime fatal terminal for a dispatched entry throw (PR #406); runBin rejects with the raw error (no stderr report, no status) and a SW-backed child prints its own `stack ?? message` with status 1 regardless of `exitCode`
sources: [docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/workbench/src/workers/no-coi-toolchain-owner.ts, packages/runtime-js/src/ipc/no-coi-child-worker.ts, packages/workbench/src/workers/no-coi-project-command.ts]
---

## Context

PR #406 outside findings 1–2 (the sweep of `runNodeEntry`'s sync-fatal call
sites). Code read at `294673988`, not probed:

- `runInstalledBin` (`no-coi-toolchain-owner.ts`): `runNodeEntry` throws after
  `beginFatal`; the catch rethrows the error (a declared gap by name), so
  `toolchain.runBin` rejects — no fatal report on the runtime stderr events, no
  `exitCode`.
- `installNoCoiChildWorker` (`no-coi-child-worker.ts`): the catch writes
  `error.stack ?? error.message` and posts `control:self-exit` 1, ignoring an
  `'exit'` listener's `exitCode` (it writes the stderr port directly, so a
  guest patch does not hide it — Node-like).

Node v24.16.0 (`src/node_errors.cc` TriggerUncaughtException): report to fd 2,
status `exitCode` after the `'exit'` listeners, else 1 (probe 2026-11-18:
`'exit'` listener `exitCode = 5` + throw → 5). Neighbours:
`no-coi-command-unhandled-rejection-exit` owns async throws and realm
replacement; `runtime-js/process-exit-listener-effects` owns the `exitCode`
status for kernel children and no-COI async throws — this item owns both hosts'
sync-throw status. Fault: `sibling-drift` at the in-process host terminal.

## Next

Owner distribution (workbench toolchain) + runtime-js ipc. Probe both hosts
against live Node (carriers to extend: `no-coi-process-exit-status.spec.ts`
binCases, `no-coi-child-processes.spec.ts`) before choosing the terminal's owner.
