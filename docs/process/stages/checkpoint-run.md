# Checkpoint run — runner procedure (both checkpoints)

The runner is a worker session; the reviewer is a fresh `codex exec`. Rules:
`../rules/review.md`, budget/stops: `../rules/stops.md`, output:
`../artifacts/verdict.md`.

## Setup

- With a PR: `gh pr view <n> --json body,headRefName,baseRefName`; raw body =
  the unit's claim. `BASE` per `REV-1`. Name `CHECKPOINT`; ambiguity stops.
- Refuse a dirty tree. Never poll or read reviewer stdout: the verdict is the
  `-o` JSON, liveness is the process state; the log is post-mortem only.
- Run the reviewer and any test battery as background tasks with a completion
  notification; work meanwhile (next-slice prep, PR text). Idle polling is a
  defect (`../rules/decisions.md` `DEC-5`).

```sh
RUN=$(mktemp -d -t rifty-review.XXXX)
codex exec -C "$(git rev-parse --show-toplevel)" --approve-for-me \
  -c model_reasoning_effort="ultra" \
  --skip-git-repo-check --output-schema tools/review/review-schema.json -o "$RUN/verdict.json" \
  "Invoke the rifty-review skill for the $CHECKPOINT checkpoint against BASE $BASE. \
Read docs/process/rules/review.md fully and apply it by rule id: REV-1 scope (BASE is the unit-of-work boundary; certified slices and carriers raise no row), \
REV-2 authority (a blocker cites I#, a scenario line, a traced unit row, an ADR, a rule id, or baseline; untraced rows and strengthening beyond the clause are concerns), \
REV-3 severity, REV-4 coverage (one row per TRACED obligation in boundary, with its trace; weak = advisory), REV-5 evidence bar for $CHECKPOINT, REV-10 axes in order. \
Do not modify tracked files. Single exhaustive pass: partition the diff, spawn parallel read-only subagents, merge and dedupe. Return only schema JSON with file:line citations." \
  </dev/null >"$RUN/log" 2>&1
node tools/review/blockers.mjs "$RUN/verdict.json"   # missing verdict → tail -n 40 "$RUN/log"
```

`--approve-for-me` = workspace-write sandbox with escalations judged by the
automatic reviewer; `</dev/null` is load-bearing (no TTY → codex parks on
stdin).

## One round

1. **Find pass** — the command above.
2. **Tail pass** — band ≥ 5 only (`RDY-9`, both checkpoints): fresh `$RUN`, prompt appended with
   `PRIOR FINDINGS (settled, do not re-raise; report ONLY defects not on this
   list; nothing new → say so in merge_call):` + pass-1 findings as
   axis-prefixed one-liners. Union = the round's set.
3. **Adjudication** — BEFORE fixing: a fresh read-only critic takes the union
   blocker list (summary + authority + location only), reads each cited
   authority in full and the cited carriers, rules HOLDS / STRETCH / FALSE
   (`../artifacts/verdict.md`), writes `$RUN/adjudication.json`; then
   `node tools/review/blockers.mjs "$RUN/verdict.json" "$RUN/adjudication.json"`.
   Only HOLDS + `missing` rows force the re-cut; STRETCH/FALSE join the
   concern batch. The verdict file stays untouched (lineage).
4. **Record** the verdict line in the unit's `## Decisions` (`REV-8`) — before
   any fix.
5. **Stop check** (`STOP-2`, `STOP-3`): rounds spent ≥ declared, or a blocker
   unchanged since the previous verify → `STOP-4` re-cut, not another round.
6. **Batch fix** — one re-cut in place fixing ALL surviving blockers; never
   weaken a ready contract silently (`RDY-5`); never edit a test to pass.
7. **Verify pass** — same command, prior verdicts attached as settled. Exit 0
   → done. Exit 1 → back to 4. Exit 2 → retry once, then stop.

Concerns never spend a round: batch them to backlog (`rifty-to-backlog`) or
fix at the agent's choice after the verdict.
