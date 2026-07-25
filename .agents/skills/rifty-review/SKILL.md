---
name: rifty-review
description: Manually perform one read-only rifty PR review against its frozen contract and goal.
---

Review raw contract, baseline, PR body, diff, and tests. Apply
`docs/process/fault-classes.md` §Review convergence.

Report these axes once, in order:

1. **Completeness** — every unit clause covered; no required deferral.
2. **Mission and architecture** — fits rifty's mission and boundaries.
3. **Goal drift** — delivery matches exact `Goal-Baseline`, else ready contract.
4. **Approach cost** — identify removable machinery: contract deliverable without it → blocker, first instance included; pure code shrinkage → residual note, never a checkpoint condition. Apply §Class-kill.
5. **Budget** — one declared slice; inspect modified files, not only advisory scans.
6. **Bugs** — no correctness defect.
7. **Regressions** — existing behavior holds.
8. **Ecosystem UX** — observable behavior matches real Node software.

Contract+RED checks oracle/RED coverage; Final+GREEN checks delivery. Correctness
blockers name class, RED, and sibling sweep; other blockers cite their rule.

Open with verdict + merge call. Return `checkpoint`, exact `unit_goal_source`,
ordered axes, `unit_residuals` (slice blockers), `goal_residuals` (continuation),
and `goal_complete` only after end-to-end proof with both residual sets empty.
Cite `file:line`.
