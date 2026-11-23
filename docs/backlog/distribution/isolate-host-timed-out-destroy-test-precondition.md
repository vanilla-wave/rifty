---
area: distribution
status: draft
title: The "destroy after a timed-out run waits" carrier depends on its deadline landing inside the first sort
created: 2026-11-23
why: Its precondition (the worker still holds 300 MiB right after the timed-out result) failed twice under load — at a 1.5 s deadline (load 74) and at 3.5 s (load ~13) — with `held: false`.
sources: [packages/isolate-host/tests/sandbox-faults.test.ts, PR-419-external-review]
code: [packages/isolate-host/tests/sandbox-faults.test.ts]
---

## Context

Steadied 2026-11-23: 5e6 doubles (first sort ~9 s on an M3) and a 4 s deadline. The row
is timing-based in both directions. Too fast: a host that finishes the first sort before
the deadline runs only fast sorts of the sorted array after it, so the isolate stops at
once and `held` is false. Too slow: a deadline before the 300 MiB is filled finds no
worker above 400 MiB (`held` false); one inside `Array.from` (guest JS, which honours
termination) holds the memory without a builtin keeping the isolate. The
`sandbox-destroy-table` timeout rows observe only that no worker burns CPU after
`destroy()` (`burned < 0.1`), not `termination: 'timeout'` nor the stopping isolate this
row needs. A builtin with a fixed duration that ignores termination would remove the
dependency. Owner: distribution (isolate host). Trigger: the next red of this row on CI
or a scratch run.

## Challenge

challenge: 2026-11-23 — none yet (factual capture at the live-sandbox goal's close, ADR-0568)
