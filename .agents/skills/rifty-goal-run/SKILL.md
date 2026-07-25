---
name: rifty-goal-run
description: Continue a declared autonomous rifty ready-epic goal through just-in-time slices. Invoke only for a task/PR with Goal-Baseline or an explicit whole-epic hand-off. Excludes ordinary items, “continue the plan” without that marker, single fixes/PRs, expected RED, and process/docs/skill work.
---

# rifty-goal-run

Own the frozen outcome, not a prewritten plan. The binding data contract is
`docs/backlog/README.md` §Autonomous goal.

## Continue until closure

1. Bootstrap or inherit the write-once marker; declare the matching `Goal-Baseline` and one `Budget-Slice`.
2. Pick one dependency-ready residual. Compile a settled draft normally; surface only a remaining observable fork for manual `rifty-refine`.
3. Run Contract+RED, then implement the ready unit. Planned work and expected RED never invoke `rifty-fix`.
4. Classify discoveries against the frozen goal/tier/Fidelity: required → reverse-linked goal residual; outside → `rifty-to-backlog`.
5. Budget trip or Final+GREEN unit residual → re-cut the unit/mechanism; never narrow the goal, detach required work, auto-fix, or start review three.
6. Unit clean with goal residuals → close only that unit and continue.
7. Close the goal only when no reverse-linked children remain, review returns `goal_complete: true` with empty residuals, and end-to-end acceptance + DoD are green on one SHA; then delete the epic.

Only the user may change the observable baseline. Show any conflict against its exact clause.
