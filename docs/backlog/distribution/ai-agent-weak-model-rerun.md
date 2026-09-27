---
area: distribution
status: draft
title: Re-run the recorded weak-endpoint baseline with the same config, tasks and runs after the mechanism slices land, and compare per task with no pass regression
created: 2026-09-27
why: Without a post-change measurement every mechanism of the goal could hold while task solving gets worse (critic finding 1); the delta on the same tasks is the goal's own evidence.
user_story: As the maintainer, I want to see per task whether compaction, retry, budgets, edit diagnostics, the repeat guard, the verification feed and the recipe changed pass, budget, tokens and time on the same weak endpoint, but today there is no second run to compare and no comparison table.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-budget-visibility, distribution/ai-agent-transient-request-retry, distribution/ai-agent-context-compaction, distribution/ai-agent-edit-failure-diagnostics, distribution/ai-agent-repeated-call-guard, distribution/ai-agent-verification-feed, distribution/ai-agent-prompt-recipe]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md]
code: [tools/agent-bench/src/report.ts, tools/agent-bench/src/cli.ts]
---

## Context

finding — goal slice 12 (I13); last.

- Input: the baseline summary from slice 4 (`reports/summaries/<date>-gpt-6-luna/`),
  its config (catalog entry, limits, runs) and task set.
- After this slice: `pnpm agent-bench report --compare <baseline-dir>` (or the
  report command reading a `baseline` path in config) renders per task and
  lane: passes / runs, budget-exceeded, context-exceeded, median seconds,
  median tools, input/output tokens, retries, compactions, repeated-call
  notices, edit failures — for both runs and the delta; the new summary lands
  under `reports/summaries/` with manual failure classes. Smallest carrier:
  two summary directories of one config; the quality goal's report owner
  `distribution/agent-eval-comparison-report` (PR #341) absorbs it (goal
  §Decisions "shared bench order"). A ±1-pass delta on 3 runs is marked as
  within noise in the table (user 2026-09-27 «5 - ок»).
- Criterion (goal §Decisions "re-run criterion"): no task with fewer passes
  than the baseline (3 runs each); a regression is a defect → `rifty-fix` on
  the responsible slice before CLOSE, or an explicit user amendment
  (`RDY-6`); noise is reported, not averaged away.
- The comparison decides which Out-of-scope mechanisms (goal map) get a
  draft; it never edits this goal's invariants.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (re-run criterion, bench lane order, first baseline endpoint, tier).
