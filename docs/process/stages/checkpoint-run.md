# Checkpoint run — runner procedure (both checkpoints)

The runner is the driver session; the reviewer is a fresh `codex exec`. Rules:
`../rules/review.md`, budget/stops: `../rules/stops.md`, output:
`../artifacts/verdict.md`.

## Setup

- With a PR: `gh pr view <n> --json body,headRefName,baseRefName`; raw body =
  the unit's claim. `BASE` = the `<sha>` of the last `re-chart after … (final-green
  PASS @ <sha>)` ledger line reachable from HEAD — for slices landed before
  2026-09-03 the ledger's `Final+GREEN PASS @ <sha>` line — else the branch
  base (`REV-1`, `REV-8`). Name `CHECKPOINT`; ambiguity stops.
- Refuse a dirty tree. Never read reviewer stdout: the verdict is the `-o`
  JSON, liveness is the process state — a wait has no deadline; the log is
  post-mortem only.
- Wait per the harness (`../rules/decisions.md` `DEC-5`): Claude — background
  task + completion notification; Codex — one empty `write_stdin` per 5 min,
  nothing between polls (no status message, no `ps`, no log).

```sh
RUN=$(mktemp -d -t rifty-review.XXXX)
codex exec -C "$(git rev-parse --show-toplevel)" --approve-for-me \
  -c model_reasoning_effort="ultra" \
  --skip-git-repo-check --output-schema tools/review/review-schema.json -o "$RUN/verdict.json" \
  "Invoke the rifty-review skill for the $CHECKPOINT checkpoint against BASE $BASE. \
Read docs/process/rules/review.md fully and apply it by rule id: REV-1 scope (BASE is the unit-of-work boundary; certified slices and carriers raise no row), \
REV-2 authority (a blocker cites I#, a scenario line, a traced unit row, an ADR, baseline, or a REV-2-listed rule; any other rule id, untraced rows and strengthening beyond the clause are concerns), \
REV-3 severity, REV-4 coverage (one row per obligation traced to I#/scenario/ADR in boundary, with its trace; rule-id-only rows raise none; weak = advisory), REV-5 evidence bar for $CHECKPOINT, REV-10 axes in order. \
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
4. **Record** — overwrite the checkpoint's status line in the unit's
   `## Decisions`: `final-green: round <n>/<budget> — blocker @ <sha>`
   (`REV-8`). Leave it uncommitted; it commits with the fix batch.
5. **Stop check** (`STOP-2`, `STOP-3`): `<n>` ≥ budget, or a blocker unchanged
   since the previous verify → `STOP-4` re-cut, not another round. `<n>` and a
   spent re-cut (`re-cut:` line) are read from the unit doc, never from
   session memory — a re-invoked run continues the count.
6. **Batch fix** — one re-cut in place fixing ALL surviving blockers, committed
   together with the status line; never weaken a ready contract silently
   (`RDY-5`); never edit a test to pass.
7. **Verify pass** — same command, prior verdicts attached as settled. Exit 0
   → done: Contract+RED writes `ready-verdict:`; Final+GREEN lands and RECHART
   writes `re-chart after <slice> (final-green PASS @ <sha>)`. Exit 1 → back
   to 4. Exit 2 → retry once, then stop.

A PASS holds while `git diff --quiet <sha> HEAD -- . ':!docs/backlog'
':!CHANGELOG.md'` is empty (`REV-8`); check it before merge.

Concerns never spend a round: batch them to backlog (`rifty-to-backlog`) or
fix at the agent's choice after the verdict.
