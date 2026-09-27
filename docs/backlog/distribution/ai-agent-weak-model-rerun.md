---
area: distribution
status: ready
title: Compare and rerun the frozen Luna benchmark after the accepted mechanisms
created: 2026-09-28
why: The accepted goal requires measured task solving without per-task regression, not mechanisms alone.
user_story: As maintainer, I want the same weak endpoint and task set measured again, with an honest baseline comparison and preserved failure evidence.
epic: agent-weak-models
sources: [docs/backlog/epics/agent-weak-models/goal.md, docs/backlog/distribution/reference/ai-agent-weak-model-baseline-evidence.md]
code: [tools/agent-bench/src/report.ts, tools/agent-bench/src/cli.ts]
---

## Context

I13, last after I7–I11 Final+GREEN. Frozen baseline40/42,
`tools/agent-bench/reports/summaries/2026-09-27-gpt-6-luna-baseline`;
config `tools/agent-bench/configs/gpt-6-luna.json`. Five unchanged tasks,
three cold runs for each supported task/lane (42 runs); no task/judge changes.

## Acceptance

1. `agent-bench report <current-dir> --compare <baseline-dir>` preserves ordinary
   report regeneration and writes a comparison artifact from the two recorded
   reports. Record both revisions/profiles/config and artifact locations; exit1
   after writing a valid comparison when regressions exist, otherwise0. → I13
2. Reject incompatible endpoint/limits/taskSet/run count or missing/duplicate/
   unmatched task-lane-run identities. Profile/revision changes are the intended
   mechanism difference; no silent intersection or missing-row averaging. → I13
3. Per task/lane show before/after/delta: pass/runs, budgets, context exceeded,
   median seconds/tools, total input/output tokens, retry/compaction/repeat/edit/
   malformed-call counts. ±1 pass on3 is labelled within noise, still reported
   as regression when negative. Never hide one task/lane loss with another gain.
   → I13
4. Actual rerun uses frozen config/task/run-count, clean committed source and
   cold isolation. Preserve all42 original run records, native traces, source
   before/after, original artifacts/hashes and available browser evidence.
   Failures manually classified; no replacing agent failures with selected retries.
   → I12, I13
5. Comparison has no task with fewer passes. A regression stays open, root cause
   is repaired under rifty-fix and subsequent full measurement retains preceding
   evidence; no task/judge recut or noise exemption. → I13
6. Final independent review checks all goal I1–I13 proof and required residuals;
   record final CLI/Chromium/CI verification, then CLOSE. No merge requested.
   → I1–I13

## Parity cases

- Real report regeneration via CLI over two report directories agrees with
  independently counted rows, medians and sums. Negative small delta stays visible.
  → I13
- Frozen baseline remains byte-identical; runner uses the same config and task
  implementations for the formal measurement. → I12, I13

## Fault matrix

| Boundary / axis | Injection | Observable result | Authority |
|---|---|---|---|
| Recorded reports / corrupt-input | Missing, duplicate, mismatched identities/config | Refuse comparison; never fabricate zero or silently intersect | → I13 |
| Aggregation / lossy-aggregate | One task loses while another gains; ±1 negative cell | Explicit regression, noise label does not erase it | → I13 |
| Measurement / provenance-lie | Infrastructure/agent failure, interrupted run | Original evidence retained and classified; no cherry-picked replacement | → I12, I13 |

## Challenge

challenge: 2026-09-28 — accepted measurable outcome; no premise/scope fork.

## Decisions

- Same task/lane rows of3 as the existing report; aggregate task totals may be
  additional context, never conceal a negative row.
- Small standalone comparison carrier is absorbed by the later quality goal;
  no second runner, judge or benchmark framework.

## Out of scope

New tasks/judges/models, completion gate, automatic fallback, planning/subagents,
merging PR359 or implementing subsequent goals PR357/341.
