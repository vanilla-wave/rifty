---
description: Run the rifty-review rubric inline, in this agent, against a PR or the current branch
argument-hint: "[PR number | base ref]  (default: origin/main)"
---

Run the `rifty-review` rubric yourself, in this context. Do not spawn an agent,
do not run `codex exec`, do not write `verdict.json`, do not run
`tools/review/blockers.mjs`.

**This is not a checkpoint.** Contract+RED and Final+GREEN require a fresh
isolated reviewer that never saw the implementer's reasoning
(`docs/process/fault-classes.md` §Review convergence, `rifty-review` §Checkpoint
run). You share that context, so this run cannot satisfy either gate, cannot
spend an attempt, and cannot authorize a merge. If a checkpoint is what's
needed, say so and stop. Use this for a user-driven look at work in progress.

## Setup

Argument `$ARGUMENTS`: a PR number, a base ref, or empty.

- PR number → `gh pr view <n> --json body,headRefName,baseRefName`; review that
  branch against `origin/<baseRefName>`; the raw body is the unit's claim.
- base ref → review the current branch against it.
- empty → `BASE=origin/main`.

Refuse a dirty tree — report it and stop. Read the raw unit contract
(`docs/backlog/**` item the work claims), the exact `Goal-Baseline` when the PR
body declares one, the full diff against BASE, and every changed test. Read
evidence, never the implementer's summary of it.

## Report these axes once, in order

1. **Completeness** — every unit clause covered; no required deferral.
2. **Mission and architecture** — fits rifty's mission and boundaries.
3. **Goal drift** — delivery matches exact `Goal-Baseline`, else the ready
   contract; a `draft→ready` flip in the diff carries its `ready-verdict:` line.
4. **Approach cost** — identify removable machinery: contract deliverable
   without it → blocker, first instance included; pure code shrinkage → goal
   residual or capture, never a checkpoint condition. Apply §Class-kill.
5. **Budget** — one declared slice; inspect modified files, not only advisory scans.
6. **Bugs** — no correctness defect.
7. **Regressions** — existing behavior holds.
8. **Ecosystem UX** — observable behavior matches real Node software.

Correctness blockers name fault class, missing RED, and sibling sweep; goal and
process blockers cite the violated clause or rule. Cite `file:line` from the
diff. A finding you cannot cite is not a finding.

## Output

Markdown, mirroring `tools/review/review-schema.json` field order so it stays
comparable to a real checkpoint verdict — but plainly labelled as an inline run:

- verdict (`pass` / `concern` / `blocker`) + one-line merge call;
- `unit_goal_source` — exact contract path and baseline used;
- the eight axes in rubric order, each with its own verdict and cited findings;
- `unit_residuals` — current-slice clauses not covered (any entry blocks the slice);
- `goal_residuals` — frozen-goal clauses still open (continuation, not a block);
- `goal_complete` only after end-to-end proof with both residual sets empty.

Close with one line naming what this run cannot do: no checkpoint spent, no
attempt counted, no merge authorized.
