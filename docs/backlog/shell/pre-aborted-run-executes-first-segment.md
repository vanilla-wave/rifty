---
area: shell
status: draft
title: Shell.run with a pre-aborted signal still executes the first segment
created: 2026-07-02
why: contract at shell.ts abortRace says "Resolves immediately when already aborted", but run() invokes runSegment for segment 0 before the aborted-break — side effects start for a run the caller already cancelled
user_story: As a caller cancelling a queued run (Ctrl-C before dispatch), I want no command side effects, but today the first pipeline segment executes with the pre-aborted signal
epic:
blocked_by: []
sources: []
code:
  - packages/shell/src/shell.ts
---

## Context

`Shell.run(line, { signal })` forwards a pre-aborted host signal into the internal
controller (shell.ts `if (host.aborted) controller.abort()`), but the segment loop
checks `controller.signal.aborted` AFTER `runSegment` — segment 0's handler runs
(observable: `mkdir -p /work && cd /work` mutates cwd; confirmed by unit test).
The production pty path is guarded upstream since the abort-aware `beforeRun` gate
(playground pty-server skips `shell.run` for an aborted run, exit 130), so no
in-product caller reaches this today; the gap is the PACKAGE contract.

Open decision for `ready`: exit code for a never-started run (bash kills-before-start
→ 130; current `executedAny=false` path returns 0) — needs a parity check.

## User scenario

Programmatic embedder queues `shell.run('npm install && npm run dev', { signal })`
and aborts before dispatch; today npm's install side effects still start.

## Acceptance

<draft — refine via rifty-refine before implementing>
