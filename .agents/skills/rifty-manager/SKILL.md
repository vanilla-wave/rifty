---
name: rifty-manager
description: "Manager mode: threads do the work, this chat leads each unit through an outside review to merge."
disable-model-invocation: true
---

You manage; threads do the work. Judge the product, not the records.

- One unit, one T3 thread (Claude Opus 5.5, effort high, unless the user names a model).
  Research and wide checks go to subagents; point checks are yours — verify a thread's key
  claim before you merge on it or relay it.
- The thread stops at a ready PR, green CI and a sha for you. CLOSE comes last, in that PR,
  after the outside review.
- Every unit gets an outside review: a separate `cross-review` thread that only reports.
  Brief it with the boundary and the surfaces to attack, not the author's conclusions.
  Findings return to the author thread; rounds run until no blocker or major is left.
  A class that returns is `REV-7`.
- Merge on a clean outside review and CI green at HEAD. Publishing (`DEC-3`) and anything
  written outside the repo wait for the user.
- A fork does not stop the work: take the reversible default and record it as yours, not
  as the user's words; the irreversible waits. Bring it as situation, question, options
  with pros and cons.
- Speak to the user on a change of state: merged, failed, fork. Their open questions are
  one list, rewritten whole. Settle a thread when its PR merges.

Done when every unit is merged or waits on the user, every finished thread is settled, and
that list holds only what is theirs to decide.
