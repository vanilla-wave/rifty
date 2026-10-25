---
area: playground
status: draft
title: One post-spawn rollback chokepoint for every owner child launcher
created: 2026-07-28
why: `runForegroundChild` builds its result inside a Promise executor, so a throw during post-spawn wiring becomes a rejection the caller's `try` cannot see, and admission is committed for a child nobody drives
user_story: As a developer whose command fails while the owner wires up a child, I want the child killed and its package slot held until it is really gone, but today the launcher would commit admission and leave an undriven worker running.
sources: [ADR-0326, ADR-0333]
code: [packages/workbench/src/glue/run-foreground-child.ts, packages/workbench/src/workers/owner-child-node-executor.ts, packages/workbench/src/workers/owner-child-bin-executor.ts, packages/workbench/src/workers/owner-child-dev-server.ts]
---

## Context

`runForegroundChild` is `return new Promise((resolve, reject) => { … })`
(~:165), so a synchronous throw inside the executor — listener registration,
private-control wiring — is converted into a rejected promise. The launchers
(`owner-child-node-executor.ts` ~:293, `owner-child-bin-executor.ts` ~:117)
assign that promise inside their `try`, so their `catch` (kill +
`reservation.abortAfterChildSettlement`) never runs and `reservation.commit`
proceeds. The spawned worker keeps running, undriven, while the caller sees a
failure.

Currently unreachable: the only explicit throw in the executor requires a
handle without `onListeningControl`, and every production spawn returns a
kernel `WorkerProcessHandle`, which always implements it
(`process-manager.ts` ~:160). The guard is an invariant, not code — a handle
shape change would make it live.

The related execSync rollback defect (treating the `terminate()` call itself as
proof of physical death) was fixed in PR #201; this item is the structural
remainder: four launcher paths each re-implement spawn → wire → commit →
rollback, and only some of them are correct at each step.

## Fork to settle

Whether the launchers share one post-spawn chokepoint that owns wiring,
commit, and rollback (killing and awaiting real exit before releasing
admission), or `runForegroundChild` stops using a Promise executor so a wiring
throw stays synchronous for the caller.
