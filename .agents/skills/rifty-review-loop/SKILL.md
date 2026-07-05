---
name: rifty-review-loop
description: Review a rifty PR branch with codex (rifty-review rubric), auto-fix every blocker, and re-review until codex reports no blockers — then report all findings across rounds. Use when the user wants an automated codex review+fix loop on a PR branch, or says "review loop", "codex review until ok", "гоняй ревью пока не ок". Manual invocation only.
disable-model-invocation: true
---

# rifty-review-loop

Drive codex as an external reviewer over a PR branch: **codex reviews → Claude fixes blockers → repeat until 0 blockers → aggregate report.** Codex only reviews (read-only); Claude does all edits. Stop condition = **no blockers** (concerns are fixed only when clearly right, else surfaced in the report).

## Setup (once per run)
1. **Resolve the branch.** Arg may be a PR number/URL, a branch name, or empty (= current branch).
   - PR number/URL → `gh pr view <arg> --json number,title,url,headRefName,baseRefName` then `git switch <headRefName>`.
   - Branch name → `git switch <arg>`; empty → stay on current branch and `gh pr view --json ...` for its PR.
2. **Base ref.** `BASE=origin/<baseRefName>` (fallback `origin/main`). `git fetch origin <baseRefName>` first so the diff is against the real base. Refuse if the working tree is dirty (commit/stash first) — the loop commits per round.
3. `RUN=$(mktemp -d -t rifty-review-loop.XXXX)`; `SKILL=<this skill dir>`. Round files land in `$RUN/round-N.json`.

## Loop (round N, cap 5)
1. **Review with codex** (read-only, unattended):
   ```
   codex exec -C "$(git rev-parse --show-toplevel)" -s read-only -c approval_policy="never" \
     --skip-git-repo-check --output-schema "$SKILL/review-schema.json" -o "$RUN/round-$N.json" \
     "Invoke the \`rifty-review\` skill and apply its full rubric to review this PR.
      Scope = changes on the current branch vs base \`$BASE\`: run \`git diff $BASE...HEAD --stat\`,
      read every changed file plus surrounding context. Cover all rubric axes (completeness/no-deferral,
      goal+architecture fit, cost-justified approach, bugs, no regressions, UX matches the real ecosystem).
      Do NOT modify any files. Return ONLY the JSON verdict matching the output schema; cite file:line in every finding."
   ```
2. **Read the verdict:** `node "$SKILL/scripts/blockers.mjs" "$RUN/round-$N.json"`.
   - exit 2 → review failed (unparseable). Retry once; if still bad, stop and report the raw output.
   - exit 0 → **converged.** Go to Finish.
   - exit 1 → blockers remain. Continue.
3. **Fix.** For each **blocker**: fix it for real (rifty fidelity — no stubs/deferral; add a failing parity/regression test first when the blocker is a bug). For each **concern**: fix only if clearly correct; otherwise record it (location + why deferred) for the report. Never edit a test just to pass.
4. **Guard + commit.** Run the fast gate on touched code (typecheck + lint); fix fallout. Commit: one-line message, no `Co-Authored-By` (e.g. `review-loop: <what>`).
5. **No-progress guard.** If this round's blocker set (location+summary) equals the previous round's, stop — codex isn't converging; report the stuck blockers.
6. N++ ; if N > 5, stop and report remaining blockers. Else repeat.

## Finish
- Run the real gate `pnpm pr:check`. If it fails, treat failures as blockers → one more fix round (respecting the cap), then re-run.
- **Never push or update the remote PR automatically** (confirm-first). Offer it as the next step.

## Report (to the user, concise)
- **Verdict trajectory:** blocker count per round (e.g. `R1: 4 → R2: 1 → R3: 0`), rounds used, converged / stuck / hit-cap.
- **Fixed:** per axis, each blocker/concern addressed → commit sha.
- **Deferred concerns:** codex's remaining concerns/nits at exit + one-line rationale each (these are the user's call).
- **Gate:** `pnpm pr:check` result.
- **Artifacts:** `$RUN/round-*.json`. **Next step:** push / update PR.

## Notes
- Faithful to "со скилом rifty review": codex invokes the `rifty-review` skill by name; the axis list in the prompt is only a guardrail, not a copy of the rubric.
- Codex runs `read-only` + `approval_policy=never` → unattended, cannot mutate the repo. All mutation is Claude's, committed and gated.
- Cost: each round is a full codex review. The round cap + no-progress guard bound it; if the loop stops un-converged, say so loudly — never report a false "clean".
