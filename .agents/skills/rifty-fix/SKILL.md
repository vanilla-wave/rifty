---
name: rifty-fix
description: Repair an observed rifty runtime/package/toolchain correctness failure through root cause → fault class → RED → fix → proof. Invoke for a regression, a red gate that reproduces in isolation, an unexpectedly failing previously-green behavioral test, or a captured product defect a review found outside the unit it was reviewing.
---

# rifty-fix

A fix has nothing to trace and no contract doc: a `review: ordinary` unit by construction (`docs/process/rules/readiness.md` `RDY-8`) — one branch, one draft PR at the first commit, its RED test the proof, one fresh review after the fix (`docs/process/stages/checkpoint-run.md` §Ordinary review), findings dispositioned inline (`REV-12`), nothing journaled beyond the PR. Expected RED inside a unit under implementation is not a defect. A defect discovered inside another unit is repaired here as its own unit, never widening that one — at once, or after a capture (`rifty-to-backlog`) when it waits; a capture is for deferring, not a toll, and the fix PR deletes the capturing draft (delete on done). A capture that needs a contract — traced obligations to build, not a repro to repair (`RDY-3`) — is planned work compiled at PICKUP, not a fix. A red gate that passes on its isolated rerun (`rules/pr.md` `PR-6`) is reported, not repaired.

## Steps

1. **Root cause.** Reproduce. Cannot reproduce → no speculative fix: record the attempt as a finding draft with the repro command (`rifty-to-backlog`; `traps.md` when it is a lesson), and this unit ends — a status, not a stop; the caller runs its gate once more and, still red, does not land — the draft is its named residual (`rules/pr.md` `PR-6`), never a retry loop. A red that reproduces but resists diagnosis is the same. Trace the bad value to where it is born; instrument each boundary when the path spans layers.
2. **Class.** In `docs/process/rules/fault-classes.md`, name the axis and boundary; add a missing model first. Strike physically excluded faults — only on the boundary where step 1 traced the birth (a friendlier row = boundary-shopping), after the full sweep, each strike listed in the PR with its row and the step-1 trace evidence; surviving axes keep fault tests. Sweep the pattern repo-wide and enumerate sibling operations. A second reachable instance → §Class-kill.
3. **RED.** Add a failing parity/regression/fault test before code. Assert the honest outcome. A conflicting old test means the contract changed; do not quietly retarget it.
4. **Fix once.** Change the root owner; for a class, apply §Class-kill. Avoid wrappers and drive-by work.
5. **Prove.** RED→GREEN, then revert-check each new guard. Run touched gates and verify the committed tree.
6. **Close honestly.** If the class exceeds the unit, re-cut — the chokepoint/authority stays in the current unit; backlog takes only extra call-sites beyond it. Keep active-goal work reverse-linked; otherwise capture it. Backlog never makes a partial repair complete.
