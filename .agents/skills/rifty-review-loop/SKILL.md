---
name: rifty-review-loop
description: "Run one of rifty's two bounded PR review checkpoints with the rifty-review rubric: Contract+RED before implementation, or Final+GREEN for merge versus redesign/split. Use when the user asks for a rifty review loop, review checkpoint, or review until okay. Manual invocation only."
disable-model-invocation: true
---

# rifty-review-loop

Run one read-only Codex review per checkpoint. The legacy name stays for compatibility; this skill never starts a third point-fix round. Binding protocol: `docs/process/fault-classes.md` §Review convergence.

## Setup

1. Resolve the PR branch. PR number/URL → `gh pr view <arg> --json number,title,url,headRefName,baseRefName`, then switch to `headRefName`; branch → switch to it; empty → use the current branch and its PR.
2. Fetch the base and set `BASE=origin/<baseRefName>` (fallback `origin/main`). Refuse a dirty tree.
3. Select the checkpoint from the PR description or explicit request. If ambiguous, use Contract+RED and report the ambiguity.
4. Create `RUN=$(mktemp -d -t rifty-review-loop.XXXX)` and set `SKILL=<this skill dir>`.

## Contract+RED

Review the pinned oracle, acceptance/parity rows, loud gaps, architecture choice, and executable RED proof. A blocker ends the checkpoint as redesign/split; implementation does not begin.

## Final+GREEN

Run `pnpm pr:check` on the committed SHA first. A failed gate is a blocker. Then review the implementation against the frozen contract and require zero blockers plus observable acceptance. Any blocker ends as redesign/split; do not fix and re-review in a third round.

## Review once

Run Codex read-only and unattended:

```sh
codex exec -C "$(git rev-parse --show-toplevel)" -s read-only -c approval_policy="never" \
  --skip-git-repo-check --output-schema "$SKILL/review-schema.json" -o "$RUN/verdict.json" \
  "Invoke the \`rifty-review\` skill for the $CHECKPOINT checkpoint. Review the current branch vs \`$BASE\`, read every changed file plus context, and apply docs/process/fault-classes.md §Review convergence. Do not modify files. Every correctness blocker must name its fault class, missing RED proof, and unswept sibling surface. Return only the schema JSON with file:line citations."
```

Run `node "$SKILL/scripts/blockers.mjs" "$RUN/verdict.json"`:

- exit 2 → retry once; a second parse failure stops the checkpoint;
- exit 0 → Contract+RED may proceed to implementation, or Final+GREEN is merge-ready;
- exit 1 → stop with redesign/split required. Never auto-fix or start a third review.

## Report

- checkpoint + committed SHA;
- per-axis verdict and findings;
- Contract+RED: oracle, RED proof, and proceed/redesign result;
- Final+GREEN: gate result and merge/redesign result;
- artifact: `$RUN/verdict.json`.

Never push or update the remote automatically without authorization.
