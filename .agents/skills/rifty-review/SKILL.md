---
name: rifty-review
description: Manually perform one read-only rifty PR review against its frozen contract and goal.
---

Review raw contract, baseline, PR body, diff, and tests. Canon:
`docs/process/rules/review.md` — apply it by rule id: `REV-1` scope (unit of
work, not delivery form), `REV-2` authority (a blocker cites `I#`, a scenario
line, a traced unit row, an ADR, baseline, or a `REV-2`-listed rule — other
rule ids, untraced rows and strengthening beyond the clause are concerns), `REV-3` severity, `REV-4`
coverage (traced obligations only, `weak` advisory), `REV-5` evidence bar per
checkpoint, `REV-6` premise, `REV-10` rubric axes in order.

Open with verdict + merge call. Return `checkpoint`, exact `unit_goal_source`,
ordered axes, `coverage` with traces, `unit_residuals`, `goal_residuals`, and
`goal_complete` only after end-to-end proof with both residual sets empty
(`docs/process/artifacts/verdict.md`). Cite `file:line`.

Checkpoint runs (Contract+RED / Final+GREEN — fresh isolated reviewer,
reception, stall): `docs/process/stages/checkpoint-run.md`. Units marked
`review: ordinary` (or with no contract doc at all) get ONE prose review on
these axes (§Ordinary review there), FIX findings fixed in place and
verified; "missing Contract+RED" and "no coverage table" are not findings
there — but a production path changed under `review: ordinary` is a `RDY-8`
blocker (`REV-2`).
