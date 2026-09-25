---
area: distribution
status: draft
title: End a no-COI resident bin when its process exits, as Node does
created: 2026-09-25
why: A no-COI resident bin (`toolchain.startBin`) whose guest calls `process.exit()` or dies by a fatal terminal after listening keeps serving, where Node's process exits and its server is gone
user_story: As an embedder running a dev server through startBin, I want a server that exits (`process.exit`, a fatal rejection, a throwing `uncaughtException` listener) to end the resident with its status, but today the preview keeps answering and no exit event fires.
sources: [docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/adr/distribution/0423-keep-no-coi-invocation-settlement-generic.md]
code: [packages/workbench/src/workers/resident-node-entry.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts]
---

## Context

REV-12 discovery of the no-COI exit-7 repair (ADR-0445 note 2026-09-25). The
resident has no drain and no control port, so nothing reads the process's
terminal. Probe 2026-09-25 (`startBin`, server listening on 5193, then
`setTimeout(() => process.exit(3), 100)`): the preview answers `alive` before
and 600 ms after, no runtime event. Node v24.16.0: the process exits 3.

Silent: the resident reports no status and keeps serving.

## Next

Own the resident's lifetime with the existing drain (`awaitDrain` with the
port `hasRef`, no cap), which now settles with the process's terminal, and end
the resident through the existing toolchain terminal frame. Open: whether the
exit event carries the status (public event shape → ADR). Carrier: a no-COI
e2e with the probe's program against live Node.

## Reversibility

REVERSIBLE — resident settlement inside the toolchain worker; an exit-status
field on the public event would be IRREVERSIBLE.
