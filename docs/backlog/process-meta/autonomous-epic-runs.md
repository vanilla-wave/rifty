---
area: process-meta
status: draft
title: Bounded autonomous epic runs — orchestration, tripwire automation, escape-rate trial
created: 2026-07-22
why: PR-176 adds frozen goal, residual accounting, one-slice budgets, and a bounded coordinator; the remaining work is adoption measurement and honest scope/mechanism detectors, not completion semantics
sources: [workbench-retro-2026-07, PR-161, PR-162, PR-176]
code: [tools/review/blockers.mjs, tools/checks/goal-contract.mjs]
---

## Context

PR #176 owns run semantics in `decision-workflow.md` §Autonomous goals plus goal/budget/contract checks.
Remaining: run one mid-size epic and compare escaped horizontal defects with the
workbench baseline. Promote only honest detectors: scope-to-unit mapping, full
mechanism inventory, review-count tracking, and explicit run membership if
concurrent source PRs require it. Until then, review owns them.
