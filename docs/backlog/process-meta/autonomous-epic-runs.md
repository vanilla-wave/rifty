---
area: process-meta
status: draft
title: Bounded autonomous epic runs — orchestration, tripwire automation, escape-rate trial
created: 2026-07-22
why: PR-176 adds frozen goal, residual accounting, one-slice budgets, and a bounded coordinator; the remaining work is adoption measurement and honest scope/mechanism detectors, not completion semantics
sources: [workbench-retro-2026-07, PR-161, PR-162, PR-176]
code: [.agents/skills/rifty-goal-run, .agents/skills/rifty-review-loop, tools/checks/goal-contract.mjs]
---

## Context

Run semantics now live in `rifty-goal-run` + goal/budget/contract checks:

- exact-SHA observable goal + persistent epic marker; live reverse-linked residuals; JIT units;
- one slice/PR, Budget authority at pickup, exact closure bookkeeping;
- fresh Contract+RED / Final+GREEN with unit vs goal residuals;
- planned work cannot route into `rifty-fix`; budget/review re-cut cannot narrow goal.

Remaining: run the next mid-size epic through it and count escaped horizontal
defects against the workbench baseline. Promote only honest detectors:
scope-to-unit mapping, full modified-file mechanism inventory, review-round
counter. Until then those stay explicit review axes; no fake CI precision.
