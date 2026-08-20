---
area: kernel
status: draft
title: SIGKILL after an accepted graceful outcome is acknowledged but physically a no-op
created: 2026-08-20
why: ProcessManager.kill answers `true` via `record.terminationRequested` (ADR-0347 idempotent settlement ack) and `_acceptOutcome` refuses a second outcome, so a SIGTERM output cut stranded on an active write can never be rescued by a later SIGKILL — the worker record hangs unkillable
sources: [PR #270 inline review 2026-08-20, ADR-0347, packages/kernel/tests/worker-terminal-drain.fault.test.ts]
code: [packages/kernel/src/process-manager.ts]
---

## Context

PR #270 made first-signal SIGKILL physical and immediate (`_terminate` SIGKILL
branch: `spawnResult.terminate()` + `_abandonTerminal()`), and its sweep calls
that branch "the single SIGKILL chokepoint". The chokepoint is unreachable once
any outcome was accepted: `kill(pid)` returns `record.terminationRequested ||
killRecordTree(...)` — an ack with no control — and `killRecordTree` bails on
`record.terminationRequested`. Same fault class as the PR's "forced termination
waits on a stranded admission": SIGTERM cut awaiting a stranded `ACTIVE` write
never settles, and escalation cannot break it.

Intake 2026-08-20: dedup found no match (`queued-process-kill-cancellation` is
the same-realm queued-handler race, different mechanism). Repro today is
fault-test-shaped only (Atomics.store of an active write, as in
worker-terminal-drain.fault.test.ts); no demonstrated real user-action path to
a stranded admission yet — draft stays until one is shown or the fault model
justifies the lane. Node oracle claim ("kill -9 always kills a SIGTERM-stuck
process") is expected POSIX behavior but carries no captured parity artifact —
open fork, capture at pickup. A fix replaces an accepted non-SIGKILL outcome
with the SIGKILL one; that contradicts ADR-0347's single-ack shape, so it needs
a superseding ADR plus RED cases: SIGKILL-after-stranded-SIGTERM closes,
double-SIGKILL stays idempotent, exit/close report the killing signal.
