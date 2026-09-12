---
area: distribution
status: draft
title: Settle a command's unhandled rejection as a Node exit, not Worker replacement
created: 2026-09-11
why: A project command whose guest leaves an unhandled promise rejection ends in forced Worker replacement with unknown effects, where real Node exits 1 with known effects
user_story: As an embedder running agent commands, I want `node script.js` with an unhandled rejection to report `exitCode 1` and its applied effects, but today the drain rejects, the invocation requires termination and the Worker is replaced.
sources: [docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/adr/distribution/0423-keep-no-coi-invocation-settlement-generic.md]
code: [packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

`awaitDrain` rejects when the realm recorded an `unhandledrejection`
(event-loop-keepalive.ts). `executeNode` in no-coi-project-command.ts treats
every drain rejection as `requiresTermination`; the host then replaces the
Worker and reports `worker: 'replaced'`, `effects: unknown`. `runInstalledBin`
(ADR-0423) instead takes the pending rejection, maps a projected process exit to
its code and keeps the Worker. Real Node prints the error and exits 1; pending
timers die with the process.

## Options or Next

- Mirror ADR-0423 in the command path: consume the pending rejection, map a
  projected exit to `exitCode`, then retire timers/listeners as for a normal
  exit. Keep termination only when live handles remain (`activeRefs()`,
  `listPorts()`), because a reused Worker cannot abandon them like a dying
  process.
- Carrier: unit RED with `node -e "Promise.reject(new Error('boom'))"` expecting
  `status: 'failed', exitCode: 1, worker: 'retained'`, plus a live-listener
  variant that still requires termination.
- Loud today (explicit failed/replaced outcome), so not a Fidelity blocker; an
  Ecosystem UX gap for common agent-authored code.

## Reversibility

REVERSIBLE — invocation settlement policy inside the existing owners.
