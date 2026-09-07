# Review run — one procedure and one verdict

Driver stays in-session. Rules: `../rules/review.md`; data and validator:
`../artifacts/verdict.md`, `tools/review/blockers.mjs`.

## Evidence and reviewer

Name CHECKPOINT (`Contract+RED` or `Final+GREEN`), UNIT (contract path, or PR
number plus the observed baseline), and BASE (previous slice or branch base).
The tree is clean. A fresh independent reviewer reads raw authorities, diff
and artifacts; no implementer's diagnosis. It may execute probes/mutants in a
detached scratch copy; never edit the work under review.

```sh
RUN=$(mktemp -d -t rifty-review.XXXX)
codex exec -C "$(git rev-parse --show-toplevel)" --approve-for-me \
  -c model_reasoning_effort="ultra" --skip-git-repo-check \
  --output-schema tools/review/review-schema.json -o "$RUN/verdict.json" \
  "Invoke rifty-review for $CHECKPOINT of $UNIT against BASE $BASE. Read docs/process/rules/review.md and apply its evidence bar. Use raw evidence; inspect changed checking criteria against BASE (PR-4). Return schema JSON, with executed artifacts for repro/mutant claims. Never edit tracked files." \
  </dev/null >"$RUN/log" 2>&1
node tools/review/blockers.mjs "$RUN/verdict.json"
```

Liveness is the child process; stay in-session until completion (`DEC-5`). An
invalid report is a harness failure, not an accepted review: retry once, then
report its error without asking whether to continue.

## Reception and verification

1. Driver verifies every finding against its authority and evidence (`REV-12`).
   A valid blocker is FIX; advice is NOTE. Accepting a justified repair needs
   no second critic. A disputed blocker goes to one fresh independent critic,
   with the original evidence; the implementer cannot dismiss its own defect.
2. The critic records HOLDS / FALSE / STRETCH with the clause and evidence.
   Only disputed findings need rulings. A Fidelity blocker is rejected only
   with evidence of FALSE, never by narrowing its authority. Attach rulings
   as `adjudication` in the same JSON; validate again with `blockers.mjs`.
3. If the report itself is mistaken, the same independent reviewer/critic
   corrects that evidence with its reason and revalidates it. No new context
   or invented product change is required; no blanket clearing of residuals.
   Fix the surviving product blockers together. Commit, then have the independent
   reviewer verify the actual changed tree, including whether the fixes work.
   Prior rulings are evidence, not immunity: a new artifact reopens a finding.
4. PASS → driver adds `reviewed_sha` and commits this same JSON under
   `docs/backlog/<area>/reference/<slug|pr-N>-{contract-red,final-green}.json`.
   A docs-only review may be posted to the PR. Use the single validator both
   now and at merge; no separate prose/ordinary verdict format.
5. Continue the next stage. A surviving identical failure with no new evidence
   changes the approach (`STOP-3..4`); it never consumes a numeric budget.

A small docs review still has independent eyes; it has empty product coverage
and no manufactured contract, RED, challenge, critic or report-writing agent.
