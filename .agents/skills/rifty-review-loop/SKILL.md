---
name: rifty-review-loop
description: Run exactly one rifty Contract+RED or Final+GREEN checkpoint. Invoke only when the user explicitly asks for a checkpoint/review loop, or an active `rifty-goal-run` reaches that named checkpoint. Never invoke as an automatic repair loop or ordinary “continue the plan” step.
---

# rifty-review-loop

Run one read-only Codex review per checkpoint. The legacy name stays for compatibility; this skill never starts a third point-fix round. Binding protocol: `docs/process/fault-classes.md` §Review convergence.

## Setup

1. Resolve the PR branch and raw PR body. PR number/URL → `gh pr view <arg> --json number,title,url,body,headRefName,baseRefName`, then switch to `headRefName`; branch → switch to it; empty → use the current branch and its PR.
2. Fetch the base and set `BASE=origin/<baseRefName>` (fallback `origin/main`). Refuse a dirty tree.
3. Select the named checkpoint. If ambiguous, stop; a wrong checkpoint is not independent review.
4. Read `Goal-Baseline` when present and the current-unit ready contract from raw artifacts. Do not pass the implementer's diagnosis or previous review framing to the fresh reviewer.
5. Create `RUN=$(mktemp -d -t rifty-review-loop.XXXX)` and set `SKILL=<this skill dir>`.

## Contract+RED

Review the pinned oracle, acceptance/parity rows, loud gaps, architecture choice, and executable RED proof. `unit_residuals` are uncovered unit clauses; `goal_residuals` are known work after this slice. A unit blocker ends the checkpoint as redesign/re-cut; implementation does not begin.

## Final+GREEN

Run `pnpm pr:check` on the committed SHA first. A failed gate is a unit blocker. Review implementation against the frozen unit and run goal. Any unit blocker ends as redesign/re-cut; do not invoke `rifty-fix`, auto-fix, or re-review in a third round.

## Review once

Run Codex read-only and unattended:

```sh
codex exec -C "$(git rev-parse --show-toplevel)" -s read-only -c approval_policy="never" \
  --skip-git-repo-check --output-schema "$SKILL/review-schema.json" -o "$RUN/verdict.json" \
  "Invoke the \`rifty-review\` skill for the $CHECKPOINT checkpoint. Review raw current branch vs \`$BASE\`, the PR body, exact Goal-Baseline when declared, current-unit contract, and every changed file. Do not modify files. Fill checkpoint, unit_goal_source, every required axis, unit_residuals, goal_residuals, goal_complete. Behavioral correctness blockers name fault class, missing RED, sibling sweep; goal/process blockers cite the violated contract/rule. Return only schema JSON with file:line citations."
```

Run `node "$SKILL/scripts/blockers.mjs" "$RUN/verdict.json"`:

- exit 2 → retry once; a second parse failure stops the checkpoint;
- exit 0 → current checkpoint/unit passes. If `goal_complete:false`, the goal run MUST continue after this honest slice; merge-ready ≠ task done.
- exit 1 → current unit stops for redesign/re-cut. Never auto-fix or start a third review.

## Report

- checkpoint + committed SHA;
- per-axis verdict and findings;
- Contract+RED: oracle, RED proof, unit residuals, proceed/redesign;
- Final+GREEN: gate, unit residuals, merge/redesign;
- goal residuals + `goal_complete`; never collapse slice completion into goal completion;
- artifact: `$RUN/verdict.json`.

Never push or update the remote automatically without authorization.
