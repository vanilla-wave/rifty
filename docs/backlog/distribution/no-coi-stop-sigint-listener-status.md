---
area: distribution
status: draft
title: "Stopping a no-COI command whose program handles SIGINT reports the program's exit status"
created: 2026-11-18
why: a stopped project command whose SIGINT listener calls `process.exit(0)` completes `cancelled` with exitCode 130; Node's process exits 0, the listener's status
sources: [docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, packages/rifty/README.md]
code: [packages/shell/src/shell.ts, packages/workbench/src/workers/no-coi-project-command.ts, packages/rifty/src/sandbox-project.ts]
---

## Context

PR #408 outside finding 4. `tests/no-coi/no-coi-shared-realm.spec.ts`
`eval-stop` step `node -e "process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1000); console.log('L|ready')"`, stopped after `L|ready`:
rifty `{ status: 'cancelled', exitCode: 130 }` (RED run of PR #408, before the
row was narrowed to `status`); live Node v24.16.0 with SIGINT → exit code 0.
The Shell resolves an aborted run with `SIGINT_EXIT` 130 (`shell.ts:101`,
`:223`) regardless of the handler's terminal; the README documents 130 only
for a program without a handler. Whether `cancelled` stays the status is an
SDK question (ADR-0418 §3); the exit code is Node's. Terminal Ctrl-C (COI) is
unmeasured.

## Next

Owner distribution (SDK command) with shell. Carrier: the `eval-stop` rows
compare `exitCode` to live Node again once the handler's terminal reaches the
completion.
