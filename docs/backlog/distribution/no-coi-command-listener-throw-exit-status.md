---
area: distribution
status: draft
title: No-COI project command reports status 7 when an `uncaughtException` listener throws, as in Node
created: 2026-09-25
why: In a no-COI in-process `node` command a throwing `uncaughtException` listener (after a rejection or a timer throw) settles `status: 'exited', exitCode: 0`, where Node exits 7 — a silent wrong status
user_story: As an embedder running agent commands, I want a program whose `uncaughtException` listener throws to report `exitCode 7`, but today `sandbox.project().run` reports 0.
sources: [docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/adr/distribution/0423-keep-no-coi-invocation-settlement-generic.md, docs/public/compat/process.md]
code: [packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Split from `distribution/no-coi-command-unhandled-rejection-exit` (probe
2026-09-25, `94588bd17`, `sandbox.project().run`): a throwing
`uncaughtException` listener after `Promise.reject(new Error('R'))` or a
`setTimeout` throw → `status: 'exited', exitCode: 0`, stderr `Error: L`.
Node v24.16.0 exits 7 for both (`node rejection.cjs` / `node timer.cjs`;
re-probed 2026-09-25: `rejection 7`, `timer 7`).

Mechanism: ADR-0445 rule 4's `listenerThrew` requests exit 7 through the
`NodeProcess` exit (`process-lifecycle-events.ts`), whose kernel request goes
to the control port; the in-process host has none, and the realm trap
records nothing for an `exited` dispatch (`event-loop-keepalive.ts`), so
`executeNode`'s drain resolves and its natural `exit()` terminates with
`exitCode ?? 0` (`NodeProcessExit.exit` ignores the earlier terminal);
`runInstalledBin` reads `exitCode` the same way (code reading). Fires on
timer throws too, not only rejections. Not loud — Fidelity.

Same owner family as `distribution/no-coi-command-natural-exit-reassigned-exit`
(no-COI in-process exit ignores a Node lifecycle exit request); compat ⚠️
`docs/public/compat/process.md` "Handler dispatch in no-COI in-process
project commands".

## Next

Owner distribution (no-COI command settlement, ADR-0418/0423). Carrier:
`no-coi-project-command.test.ts` RED with both programs expecting
`exitCode: 7` and no `'exit'`, plus the run-bin path.
