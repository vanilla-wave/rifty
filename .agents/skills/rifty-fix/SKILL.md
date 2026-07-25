---
name: rifty-fix
description: Repair an unexpected, observed rifty runtime/package/toolchain correctness failure through root cause → fault class → RED → fix → proof. Invoke for a regression or flake, an unexpectedly failing previously-green behavioral test, or a concrete product-code review defect requested for repair. Excludes “continue/follow the plan”, other planned/ready work, expected RED, features/refactors, and process/docs/skills/review policy.
---

# rifty-fix

Apply the description's scope gate first. A task stays planned even when its title says “fix”.

## Steps

1. **Root cause.** Reproduce. Trace the bad value to where it is born; instrument each boundary when the path spans layers.
2. **Class.** In `docs/process/fault-classes.md`, name the axis and boundary; add a missing model first. Strike physically excluded faults. Sweep the pattern repo-wide and enumerate sibling operations. A second reachable instance requires §Class-kill; a third coordination mechanism on the same state requires one authority.
3. **RED.** Add a failing parity/regression/fault test before code. Assert the honest outcome. A conflicting old test means the contract changed; do not quietly retarget it.
4. **Fix once.** Change the root owner; for a class, apply §Class-kill. Avoid wrappers and drive-by work.
5. **Prove.** RED→GREEN, then revert-check each new guard. Run touched gates and verify the committed tree.
6. **Close honestly.** If the class exceeds the unit, re-cut. Keep active-goal work reverse-linked; otherwise capture it. Backlog never makes a partial repair complete.
