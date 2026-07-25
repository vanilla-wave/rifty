---
name: rifty-review
description: Manually perform one read-only rifty PR review against its frozen contract, mission, architecture, regressions, and implementation cost.
---

Review the PR.
Especially interested in:
- **Completeness** — current unit contract has no uncovered clause or deferred required work.
- **Mission and architecture** — implementation fits rifty's goal and architecture.
- **Goal drift** — compare delivery with the exact `Goal-Baseline` when present, otherwise the originating ready contract. Moving a required clause to backlog/Out of scope is a blocker; an implementer cannot amend the observable goal via ADR.
- **Approach cost** — name what the diff could deliver the same contract without. Superfluous coordination/mechanism is a blocker (`fault-classes.md` §Class-kill). Optional simplification outside the frozen goal is only a concern when its maintenance cost is concrete; it does not create a merge-blocking backlog item.
- **Budget** — one declared slice; trip means re-cut, never goal narrowing or required-work deferral. Treat mechanism scan as advisory evidence and inspect modified files.
- **Bugs** — no correctness defects.
- **Regressions** — existing behavior remains intact.
- **Ecosystem UX** — observable behavior matches real Node software.

Apply `docs/process/fault-classes.md` §Review convergence. Contract+RED checks every current-unit clause has oracle/RED coverage. Final+GREEN checks delivery. Behavioral correctness blockers name fault class, missing RED, sibling sweep; goal/budget/process blockers cite their violated contract/rule instead of inventing a fault class.

## Report
Open with overall verdict + merge call. Report the eight axes above under those exact names and order. Then:

- `checkpoint`: `Contract+RED` or `Final+GREEN`; `unit_goal_source`: exact current ready contract/baseline.
- `unit_residuals`: current unit clauses not covered at this checkpoint; any entry blocks the slice.
- `goal_residuals`: frozen whole-goal clauses/children still open after an honest slice; these require continuation, not rejection of the slice.
- `goal_complete`: true only with empty goal residuals and end-to-end baseline acceptance proven.

A Final+GREEN unit blocker means redesign/re-cut, never automatic `rifty-fix` or a third point-fix round. Cite file:line.
