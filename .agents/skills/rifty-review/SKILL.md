---
name: rifty-review
description: Manually perform one read-only rifty PR review against its frozen contract and goal.
---

Review raw contract, baseline, PR body, diff, and tests. Apply
`docs/process/fault-classes.md` §Review convergence.

Report these axes once, in order:

1. **Completeness** — every unit clause covered; no required deferral.
2. **Mission and architecture** — fits rifty's mission and boundaries.
3. **Goal drift** — delivery matches the named goal (`docs/backlog/epics/<slug>/goal.md`), else ready contract; a ready `goal.md` never changes and `ledger.md` only grows; a `draft→ready` flip in the diff carries its `ready-verdict:` line; every previously merged slice carries its `re-chart after <slice>` ledger line.
4. **Approach cost** — identify removable machinery: contract deliverable without it → blocker, first instance and ported/carried machinery included (a port re-states its forcing constraint — §Class-kill); pure code shrinkage → goal residual (in a run) or capture, never a checkpoint condition. Apply §Class-kill.
5. **Budget** — one declared slice with its band in the goal's `ledger.md`; inspect modified files against it.
6. **Bugs** — no correctness defect.
7. **Regressions** — existing behavior holds.
8. **Ecosystem UX** — observable behavior matches real Node software.

Checkpoint machinery covers work under §Review convergence (parity/stateful) —
there Contract+RED always precedes implementation and a unit that skipped it
cannot jump to Final+GREEN; Final+GREEN checks delivery. Outside that scope
(docs/CI/process/tooling) a PR gets ONE review on these axes: blockers are fixed
in the same PR, "missing Contract+RED" is not a finding. Correctness blockers
name class, RED, and sibling sweep; other blockers cite their rule.

Open with verdict + merge call. Return `checkpoint`, exact `unit_goal_source`,
ordered axes, `unit_residuals` (slice blockers), `goal_residuals` (continuation),
and `goal_complete` only after end-to-end proof with both residual sets empty.
Cite `file:line`.

## Checkpoint run (Contract+RED / Final+GREEN)

One fresh isolated reviewer per named checkpoint — raw evidence only, never the
implementer's diagnosis. Setup: with a PR — resolve branch + raw body (`gh pr
view <arg> --json body,headRefName,baseRefName`), `BASE=origin/<baseRefName>`;
without one — Contract+RED runs locally: `BASE=origin/main` (or the declared
base), the goal named by its directory. A PR is never a prerequisite
for Contract+RED; attempts count per unit either way — keep every verdict.
Refuse a dirty tree; name `CHECKPOINT` (ambiguity stops). Open the unit's single
draft PR at the first Contract+RED pass — never one per attempt; it lives
through every later checkpoint, blocker, and re-cut until merge (checkpoints
spend attempts, never the PR — `fault-classes.md` Lineage row), its body naming
prior local verdict SHAs. Final+GREEN requires the PR and first runs
`pnpm pr:check` on the committed SHA.

`--approve-for-me` = workspace-write sandbox with escalations judged by the
automatic reviewer: the checkpoint can actually run gates (`pnpm pr:check`
writes gitignored artifacts) while "Do not modify files" stays a prompt rule —
any tracked-file mutation invalidates the verdict via its tree binding.
Never poll or read reviewer stdout — the verdict is the `-o` JSON, liveness is
the process state. Log is post-mortem: read it only if `verdict.json` is missing.
`</dev/null` is load-bearing: without a TTY (background shells) codex parks on
"Reading additional input from stdin..." forever.

Reviewer effort: ultra (`-c model_reasoning_effort="ultra"`). One checkpoint =
two find passes, then one batch fix, then ONE verify pass — never
one-blocker-per-round iteration:

1. **Find pass** — exhaustive single pass: every blocker in one verdict; a
   defect visible in this tree that surfaces at a later attempt = review
   failure. The reviewer partitions the diff itself and spawns parallel
   read-only subagents (rubric axes / seams it identifies), merges + dedupes.
   It fills `coverage`: one row per contract `## Fault matrix` line,
   Acceptance/Parity clause, public API entry the diff touches, frozen
   oracle/golden. `pass` judged adversarially — a plausible wrong
   implementation must fail the cited RED. `weak` is bounded: it names the
   concrete wrong implementation AND the declared clause/failure-model row it
   violates; a mutant beyond the obligation as declared (deeper hardening) is
   a concern — the row stays `pass`. Every weak/missing row carries a finding.
   Any weak/missing row blocks (`blockers.mjs` enforces); a later gap in a
   `pass` cell is reviewer error.
2. **Tail pass** — fresh reviewer, prior findings attached as settled (do not
   re-raise; a rephrase = failure), hunts only what is NOT on the list; own
   subagents + a dedupe adjudicator. Empty tail = found set converged.

Fix all findings in one batch re-cut, then one verify pass on the new tree
(same command, prior verdicts as settled). An obligation neither pass can pin
because the contract never declared it (missing exactness, count, identity) is
a contract hole → §Contract escalation re-refine, not another review round.

```sh
RUN=$(mktemp -d -t rifty-review.XXXX)
codex exec -C "$(git rev-parse --show-toplevel)" --approve-for-me \
  -c model_reasoning_effort="ultra" \
  --skip-git-repo-check --output-schema tools/review/review-schema.json -o "$RUN/verdict.json" \
  "Invoke the \`rifty-review\` skill for the $CHECKPOINT checkpoint. Review raw current branch vs \`$BASE\`, the PR body, the named goal directory (docs/backlog/epics/<slug>/) when declared, current-unit contract, and every changed file. Do not modify tracked files. EXHAUSTIVENESS: single-pass — enumerate EVERY blocker in this one verdict; a defect visible in this tree that would only surface in a later attempt counts as a failure of this review. Partition the review yourself and spawn parallel read-only subagents (rubric axes and the seams/boundaries you identify in the diff), then merge and dedupe their findings. COVERAGE: fill the \`coverage\` section — one row per contract \`## Fault matrix\` line, Acceptance/Parity clause, public API entry point the diff adds or changes, and frozen oracle/golden artifact; judge \`pass\` adversarially (a plausible wrong implementation must fail the cited carrier — lossy/inexact assertions, non-discriminating fixtures, absent count/order/identity checks are \`weak\`); \`weak\` must name the concrete wrong implementation AND the declared clause/failure-model row it violates — a mutant beyond the obligation as declared is a concern and leaves the row \`pass\`; every weak/missing row carries a finding; do not skip rows. Fill checkpoint, unit_goal_source, every required axis, unit_residuals, goal_residuals, goal_complete. Behavioral correctness blockers name fault class, missing RED, sibling sweep; goal/process blockers cite the violated contract/rule. Return only schema JSON with file:line citations." \
  </dev/null >"$RUN/log" 2>&1
node tools/review/blockers.mjs "$RUN/verdict.json"  # missing verdict → tail -n 40 "$RUN/log"
```

Tail pass: same command, fresh `$RUN`, prompt appended with
`"PRIOR FINDINGS (settled, do not re-raise; report ONLY defects not covered by
this list; if nothing new survives, say so in merge_call):"` + the pass-1
findings list (axis-prefixed one-liners). Union of both passes = the round's
blocker set; fix batched; verify pass reuses the same appendix with both lists.

Exit 0 → unit passes (`goal_complete:false` = continue the goal); exit 1 →
re-cut in place — same branch lineage, count carries (`fault-classes.md`
§Review convergence, Lineage row); no auto-fix; exit 2 →
retry once, then stop. The verdict binds to the reviewed tree (`git rev-parse
HEAD^{tree}`) — a commit changing the tree invalidates it; rebase/reorder with
an identical tree keeps it; merge requires PR head tree == reviewed tree. Do
not edit or push.
