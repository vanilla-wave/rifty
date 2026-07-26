---
name: rifty-review
description: Manually perform one read-only rifty PR review against its frozen contract and goal.
---

Review raw contract, baseline, PR body, diff, and tests. Apply
`docs/process/fault-classes.md` §Review convergence.

Report these axes once, in order:

1. **Completeness** — every unit clause covered; no required deferral.
2. **Mission and architecture** — fits rifty's mission and boundaries.
3. **Goal drift** — delivery matches exact `Goal-Baseline`, else ready contract; a `draft→ready` flip in the diff carries its `ready-verdict:` line.
4. **Approach cost** — identify removable machinery: contract deliverable without it → blocker, first instance included; pure code shrinkage → goal residual (in a run) or capture, never a checkpoint condition. Apply §Class-kill.
5. **Budget** — one declared slice; inspect modified files, not only advisory scans.
6. **Bugs** — no correctness defect.
7. **Regressions** — existing behavior holds.
8. **Ecosystem UX** — observable behavior matches real Node software.

Contract+RED checks oracle/RED coverage and ALWAYS precedes implementation — a PR
that skipped it cannot jump to Final+GREEN; Final+GREEN checks delivery. Correctness
blockers name class, RED, and sibling sweep; other blockers cite their rule.

Open with verdict + merge call. Return `checkpoint`, exact `unit_goal_source`,
ordered axes, `unit_residuals` (slice blockers), `goal_residuals` (continuation),
and `goal_complete` only after end-to-end proof with both residual sets empty.
Cite `file:line`.

## Checkpoint run (Contract+RED / Final+GREEN)

One fresh isolated reviewer per named checkpoint — raw evidence only, never the
implementer's diagnosis. Setup: resolve the PR branch + raw body (`gh pr view
<arg> --json body,headRefName,baseRefName`), `BASE=origin/<baseRefName>`, refuse
a dirty tree, name `CHECKPOINT` (ambiguity stops). No PR yet → open the unit's
single draft PR; that PR lives through every checkpoint, blocker, and re-cut
until merge — checkpoints spend attempts, never the PR (`fault-classes.md`
Lineage row). Final+GREEN first runs `pnpm pr:check` on the committed SHA.

```sh
RUN=$(mktemp -d -t rifty-review.XXXX)
codex exec -C "$(git rev-parse --show-toplevel)" -s read-only -c approval_policy="never" \
  --skip-git-repo-check --output-schema tools/review/review-schema.json -o "$RUN/verdict.json" \
  "Invoke the \`rifty-review\` skill for the $CHECKPOINT checkpoint. Review raw current branch vs \`$BASE\`, the PR body, exact Goal-Baseline when declared, current-unit contract, and every changed file. Do not modify files. Fill checkpoint, unit_goal_source, every required axis, unit_residuals, goal_residuals, goal_complete. Behavioral correctness blockers name fault class, missing RED, sibling sweep; goal/process blockers cite the violated contract/rule. Return only schema JSON with file:line citations."
node tools/review/blockers.mjs "$RUN/verdict.json"
```

Exit 0 → unit passes (`goal_complete:false` = continue the goal); exit 1 →
re-cut in place — same PR/branch lineage, count carries (`fault-classes.md`
§Review convergence, Lineage row); no auto-fix, never a third review; exit 2 →
retry once, then stop. The verdict binds to the reviewed SHA — new commits invalidate it; merge
requires PR head == reviewed SHA. Do not edit or push.
