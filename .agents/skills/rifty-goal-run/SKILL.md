---
name: rifty-goal-run
description: "Continue an explicitly declared autonomous rifty ready-epic goal across just-in-time slices. Invoke only when the task/PR already declares Goal-Baseline or the user explicitly hands over a whole ready epic for completion. Never invoke for an ordinary ready item, 'continue the plan' without a goal baseline, a single PR/fix, expected RED, or process/docs/skill work."
---

# rifty-goal-run

Own completion of the frozen user outcome, not a prewritten implementation plan.

## Scope gate

No explicit whole-epic hand-off or `Goal-Baseline` → stop applying this skill and use the normal item/PR workflow. A ready item remains normal planned work even if its title says “fix”.

## Run contract

- Freeze `<epic>@<exact SHA>`. The live epic records the same SHA in `goal_baseline`; PR-body declarations cannot choose a newer one. Canonical goal: `value`, `tier`, Outcome, User scenario, Fidelity/DoD. Only the user can change that observable goal.
- `items`, order, mechanisms, and slice boundaries are live run state. Reverse-linked children (`epic: <slug>`) are the residual ledger; the epic’s initial list is not an exhaustive plan.
- Current unit and whole goal are separate: a slice may be complete while goal residuals remain. Never report the goal complete because one PR is merge-ready.

## Continue until closure

1. New run: land a contract-only bootstrap first — ready epic commit, then marker-only `goal_baseline` pointing to its parent; only `docs/backlog/*.md` may change. Existing run: inherit the write-once marker from merge-base. Add the matching `Goal-Baseline` and one same-epic `Budget-Slice` to each source PR; multiple slices are forbidden.
2. Pick one dependency-ready residual. Draft child: exhaust code/ADR/Node evidence; decide and record internal forks. No unresolved user-observable fork → compile the contract per `docs/backlog/README.md`, set `ready`, run `pnpm backlog:check`, continue. Observable fork remains → leave draft and surface that exact branch for manual `rifty-refine`.
3. Run Contract+RED, then implement the ready unit in the normal lane. Do not invoke `rifty-fix`: planned implementation, expected RED, and review-stop redesign are outside it.
4. Classify every discovery against the frozen goal/tier/Fidelity. Required → goal residual, reverse-link it, never detach it to ordinary backlog. Outside the goal → `rifty-to-backlog`, and do not absorb it into the slice.
5. Budget trip → re-cut mechanism/order/current unit; it never narrows the goal or launders a required clause into backlog. Final+GREEN unit residual → redesign/re-cut, not a third point-fix round.
6. Unit clean + goal residuals remain → close exact unit bookkeeping and continue with the next just-in-time unit. A remote-action approval may pause transport, never change run state to done.
7. Goal closure only with: no reverse-linked children; fresh review says `goal_complete: true` and both residual sets empty; end-to-end baseline scenario + DoD + finite checks green on one committed SHA. Then delete the epic.

At any observable-goal conflict, show the exact baseline clause and evidence. Do not autonomously weaken it through an ADR, Out of scope, backlog, or rewritten acceptance.
