---
area: perf
status: draft
title: opfs-parallel-drain acceptance ratio is load-sensitive
created: 2026-08-19
why: tests/browser-unit/opfs-parallel-drain.spec.ts failed once under runner load (perf assertion expected <= 12023, got 41786) and passed on the same tree in two other runs (observed around CI runs 32085139661 / 32085183622, 2026-08-18) — a wall-clock threshold on a shared runner flakes independently of the code under test.
sources: [handoff 2026-08-19 npm-lock-defects §Also seen]
---

## Context

The #256 I3 acceptance gate asserts a parallel-vs-serial drain ratio measured
in wall clock on the SAME run (spec already computes its own serial baseline,
which absorbs steady load but not load spikes between phases). One observed
spike flipped it RED with no product change. Options to settle at pickup:
median-of-N phases, CPU-time instead of wall clock, or marking the ratio
report-only on shared runners while asserting it locally. Judge against
`docs/process/rules/testing.md` before implementation; do not silently widen the
threshold — that erases the regression signal the gate exists for.
