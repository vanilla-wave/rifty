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

One procedure and one JSON verdict for every change:
`docs/process/stages/checkpoint-run.md`. `RDY-8` decides the required
pre-implementation proof. Never infer it from a filename, membership label
or deleted document. A no-doc repair still proves its real baseline and RED.
For changed checking criteria inspect the old criteria at BASE too (`PR-4`).
A fresh critic adjudicates disputed blockers; accepted justified repairs need
no extra adjudication. Required reference/RED proof and independent final
review remain mandatory.
