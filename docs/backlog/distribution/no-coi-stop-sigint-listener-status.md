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

PR #408 outside finding 4. Shell: an aborted run's status is overridden to
`SIGINT_EXIT` 130 (`packages/shell/src/shell.ts:223`, assigned at `:915`
`exitCodeOverride = SIGINT_EXIT`) regardless of the handler's terminal; the
`eval-stop` rows of `tests/no-coi/no-coi-shared-realm.spec.ts` compare only
`status` for that reason (comment at the `expectSameStatus` stop branch).
Uncommitted probe while writing that spec: `node -e "process.on('SIGINT', () =>
process.exit(0)); setInterval(() => {}, 1000); console.log('L|ready')"`,
`project.run(…).stop()` after `L|ready` → `{ status: 'cancelled', exitCode:
130 }`. Live Node v24.16.0, same program, SIGINT → exit 0, the listener's
status. `packages/rifty/README.md` (Stop paragraph) attributes 130 to real Node
without a handler and does not state rifty's Stop exitCode. Whether
`cancelled` stays the status is an SDK question (ADR-0418 §3); the exit code is
Node's. COI terminal Ctrl-C (compat process.md `node <file>` row "Ctrl-C →
exit 130") with a handler is unmeasured.

## Next

Owner distribution (SDK command) with shell. Carrier: the `eval-stop` rows
compare `exitCode` to live Node again once the handler's terminal reaches the
completion.
