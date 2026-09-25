---
area: distribution
status: draft
title: No-COI project command natural exit ignores a reassigned `process.exit`, as in Node
created: 2026-09-25
why: A no-COI in-process `node` command's natural exit calls the shared process's reassignable `exit()` property, so a guest that patches `process.exit` (vitest pool workers do) changes the exit, where Node's natural exit never calls it
sources: [docs/backlog/runtime-js/reference/worker-threads-handle-keepalive-evidence.md, docs/adr/runtime-js/0446-count-live-worker-threads-workers-in-child-realm-keepalive.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/workbench/src/workers/no-coi-project-command.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/worker-threads-handle-keepalive-evidence.md`
(vitest-run-in-browser item 8; evidence §Discoveries). Same fault class as
evidence §Natural exit: ADR-0446 §6 moved every node-entry owner (worker
thread, `node <file>`, `node -e`, execSync child) to the `NodeProcess` exit
captured before user code (`node-entry-bootstrap.ts` `nodeExit`).

The no-COI in-process project command is not a node-entry owner: its
natural exit is `riftyProcess.exit()` (`no-coi-project-command.ts:145`),
read at call time from the shared process object. A guest's
`process.exit = () => { throw … }` therefore turns Node's `'exit'` 0 /
status 0 into that throw's outcome. Node oracle for the same program
(`node -e`, v24.16.0): parity case
`tools/node-parity-runner/cases/process/natural-exit-patched-process-exit.case.ts`.

The no-COI tier is an unclaimed lifecycle owner (ADR-0445 Consequences;
compat ⚠️ `docs/public/compat/process.md` "Handler dispatch in no-COI
in-process project commands").

## Next

Owner distribution (no-COI command settlement, ADR-0418/0423). Trigger: the
no-COI tier claiming Node lifecycle. Carrier: `no-coi-project-command.test.ts`
RED with the parity case's program (reassigned `process.exit`, natural
exit) expecting status 0 and one `'exit'`.
