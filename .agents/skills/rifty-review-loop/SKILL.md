---
name: rifty-review-loop
description: Run one rifty Contract+RED or Final+GREEN checkpoint. Invoke only on an explicit checkpoint request or when an autonomous goal run reaches one; not as a repair loop or ordinary planned step.
---

# rifty-review-loop

Run one fresh read-only review. Binding protocol:
`docs/process/fault-classes.md` §Review convergence.

## Setup

1. Resolve the PR branch and raw PR body. PR number/URL → `gh pr view <arg> --json number,title,url,body,headRefName,baseRefName`, then switch to `headRefName`; branch → switch to it; empty → use the current branch and its PR.
2. Fetch the base and set `BASE=origin/<baseRefName>` (fallback `origin/main`). Refuse a dirty tree.
3. Set the named `CHECKPOINT`; ambiguity stops the run.
4. Read raw `Goal-Baseline` and current-unit contract. Give the reviewer no prior diagnosis or verdict.
5. Create `RUN=$(mktemp -d -t rifty-review-loop.XXXX)` and set `SKILL=<this skill dir>`.

Contract+RED reviews the oracle, contract and executable RED before implementation.
Final+GREEN first runs `pnpm pr:check` on the committed SHA, then reviews delivery.

## Review

Run once, read-only and unattended:

```sh
codex exec -C "$(git rev-parse --show-toplevel)" -s read-only -c approval_policy="never" \
  --skip-git-repo-check --output-schema "$SKILL/review-schema.json" -o "$RUN/verdict.json" \
  "Invoke the \`rifty-review\` skill for the $CHECKPOINT checkpoint. Review raw current branch vs \`$BASE\`, the PR body, exact Goal-Baseline when declared, current-unit contract, and every changed file. Do not modify files. Fill checkpoint, unit_goal_source, every required axis, unit_residuals, goal_residuals, goal_complete. Behavioral correctness blockers name fault class, missing RED, sibling sweep; goal/process blockers cite the violated contract/rule. Return only schema JSON with file:line citations."
```

Run `node "$SKILL/scripts/blockers.mjs" "$RUN/verdict.json"`:

- exit 2 → retry once; a second parse failure stops the checkpoint;
- exit 0 → unit passes; `goal_complete:false` means continue the goal;
- exit 1 → redesign/re-cut the unit; no auto-fix or third review.

## Report

Return checkpoint, SHA, axis verdicts/findings, unit decision, goal residuals/
completion, and `$RUN/verdict.json`. Do not edit or push.
