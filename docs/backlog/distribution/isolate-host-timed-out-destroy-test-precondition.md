---
area: distribution
status: draft
title: The "destroy after a timed-out run waits" carrier depends on its deadline landing inside the first sort
created: 2026-11-23
why: Its precondition (the worker still holds 300 MiB right after the timed-out result) failed twice under load (load 74, then ~13 with a 3.5 s deadline) when the first sort ended before the deadline and later sorts of the sorted array stopped fast.
sources: [packages/isolate-host/tests/sandbox-faults.test.ts, PR-419-external-review]
code: [packages/isolate-host/tests/sandbox-faults.test.ts]
---

## Context

Steadied 2026-11-23: 5e6 doubles (first sort ~9 s on an M3) and a 4 s deadline,
so the deadline lands inside the first sort on slower and loaded hosts; the
`sandbox-destroy-table` timeout rows carry the same property by CPU. Still
timing-based: a host fast enough to finish the first sort in under 4 s would
make `held` false. A builtin with a fixed duration that ignores termination
would remove the dependency. Owner: distribution (isolate host). Trigger: the
next red of this row on CI or a scratch run.

## Challenge

challenge: 2026-11-23 — none yet (factual capture at the live-sandbox goal's close, ADR-0568)
