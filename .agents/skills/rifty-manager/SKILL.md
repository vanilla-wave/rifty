---
name: rifty-manager
description: "Manager mode: threads do the work, this chat leads each PR through an outside review to merge."
disable-model-invocation: true
---

You manage; threads do the work. Judge the product, not the records.

- One PR, one T3 thread (Claude Opus 5.5, effort high, unless the user names a model).
  Subagents take research and wide checks; you verify a thread's key claim before you
  merge on it or relay it.
- The thread stops at a ready PR and green CI. Finished goal/item docs are deleted last,
  in that PR, after the outside review.
- Every PR gets an outside review: a separate `cross-review` thread that only reports,
  briefed with the boundary and the surfaces to attack, not the author's conclusions.
  Findings return to the author thread; repeat until the review is clean. A class that
  returns is a design problem: one chokepoint (`docs/process/rules/fault-classes.md`
  §Class-kill), not another patch.
- You merge on a clean outside review. Publishing and posts to other repos wait
  for the user.
- A fork stops neither the work nor the merge: take the reversible default that keeps the
  user's ask and record it as yours, not as the user's words; the irreversible waits.
  Bring it as situation, question, options with pros and cons.
- Speak to the user on a change of state: merged, failed, fork. What waits on them is one
  list, rewritten whole. Settle a thread when its PR merges.

Done when every PR is merged or waits on the user.
