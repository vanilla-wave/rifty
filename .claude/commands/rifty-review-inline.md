---
description: Run the rifty-review rubric inline, in this agent, against a PR or the current branch
argument-hint: "[PR number | base ref]  (default: origin/main)"
---

Run the `rifty-review` rubric yourself, in this context. Do not spawn an agent,
do not run `codex exec`, do not write `verdict.json`, do not run
`tools/review/blockers.mjs`.

**This is not a checkpoint.** Contract+RED and Final+GREEN require a fresh
isolated reviewer that never saw the implementer's reasoning
(`docs/process/rules/review.md` `REV-11`, `docs/process/stages/checkpoint-run.md`). You share that context, so this run cannot satisfy either gate, cannot
issue a verdict, and cannot authorize a merge. If a checkpoint is what's
needed, say so and stop. Use this for a user-driven look at work in progress.

## Setup

Argument `$ARGUMENTS`: a PR number, a base ref, or empty.

- PR number → `gh pr view <n> --json body,headRefName,baseRefName`; review that
  branch against `origin/<baseRefName>`; the raw body is the unit's claim.
- base ref → review the current branch against it.
- empty → `BASE=origin/main`.

Refuse a dirty tree — report it and stop. Read the raw unit contract
(`docs/backlog/**` item the work claims), the named goal directory when the PR
body declares one, the full diff against BASE, and every changed test. Read
evidence, never the implementer's summary of it.

## Report these axes once, in order

1. **Completeness** — every unit clause covered; no required deferral.
2. **Mission and architecture** — fits rifty's mission and boundaries (premise: `REV-6`).
3. **Goal drift** — delivery matches the named `goal.md`, else the ready
   contract; a `draft→ready` flip in the diff carries its `ready-verdict:` (or, off any production path, `review: ordinary`).
4. **Approach cost** — identify removable machinery: contract deliverable
   without it → blocker, first instance included; pure code shrinkage → goal
   residual or capture, never a checkpoint condition. Apply `REV-7`.
5. **Scope** — modified files inspected against the contract; a change no clause requires is `REV-7`.
6. **Bugs** — no correctness defect.
7. **Regressions** — existing behavior holds.
8. **Ecosystem UX** — observable behavior matches real Node software.

Blockers cite their authority (`REV-2`): correctness blockers name fault class,
missing RED, and sibling sweep; goal and process blockers cite the rule id.
Untraced rows and strengthening beyond the clause are concerns (`REV-3`). Cite
`file:line` from the diff. A finding you cannot cite is not a finding.

## Output

Markdown, mirroring `tools/review/review-schema.json` field order so it stays
comparable to a real checkpoint verdict — but plainly labelled as an inline run:

- verdict (`pass` / `concern` / `blocker`) + one-line merge call;
- `unit_goal_source` — exact contract path and baseline used;
- the eight axes in rubric order (`REV-10`), each with its own verdict and cited findings;
- `coverage` — traced obligations only, each with its trace (`REV-4`);
- `unit_residuals` — current-slice clauses not covered (any entry blocks the slice);
- `goal_residuals` — frozen-goal clauses still open (continuation, not a block);
- `goal_complete` only after end-to-end proof with both residual sets empty.

Close with one line naming what this run cannot do: no checkpoint spent, no
verdict issued, no merge authorized.
