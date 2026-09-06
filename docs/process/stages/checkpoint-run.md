# Checkpoint run — runner procedure (both checkpoints)

The runner is the driver session; the reviewer is a fresh `codex exec`. Rules:
`../rules/review.md`, stall/re-cut: `../rules/stops.md`, output:
`../artifacts/verdict.md`.

## Setup

- With a PR: `gh pr view <n> --json body,headRefName,baseRefName`; raw body =
  the unit's claim. `BASE` = the `<sha>` of the last `re-chart after … (… PASS
  @ <sha>)` ledger line reachable from HEAD — for slices landed before
  2026-09-03 the ledger's `Final+GREEN PASS @ <sha>` line — else the branch
  base (`REV-1`, `REV-8`); several such lines → the last one. Name
  `CHECKPOINT` and `UNIT` (the contract path; `verdict.md`
  `unit_goal_source`).
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
  "Invoke the rifty-review skill for the $CHECKPOINT checkpoint of unit $UNIT against BASE $BASE. \
Read docs/process/rules/review.md fully and apply it by rule id: REV-1 scope (BASE is the unit-of-work boundary; certified slices and carriers raise no row), \
REV-2 authority (a blocker cites I#, a scenario line, a traced unit row, an ADR, baseline, or a REV-2-listed rule; any other rule id, untraced rows and strengthening beyond the clause are concerns), \
REV-3 severity, REV-4 coverage (one row per obligation traced to I#/scenario/ADR in boundary, with its trace; rule-id-only rows raise none; weak = advisory unless the clause is the discrimination), REV-5 evidence bar for $CHECKPOINT, REV-10 axes in order. \
Do not modify tracked files; a REV-5 artifact that needs a stub or a mutant runs in a detached copy (git worktree add \$RUN/wt --detach) with its output attached. Single exhaustive pass: partition the diff, spawn parallel read-only subagents, merge and dedupe. Return only schema JSON with file:line citations." \
  </dev/null >"$RUN/log" 2>&1
node tools/review/blockers.mjs "$RUN/verdict.json"   # missing verdict → tail -n 40 "$RUN/log"
```

`--approve-for-me` = workspace-write sandbox with escalations judged by the
automatic reviewer; `</dev/null` is load-bearing (no TTY → codex parks on
stdin).

## One pass

1. **Find pass** — the command above. One pass, whatever the size: a second
   "tail" reviewer keyed on a size number bought nothing a fresh verify pass
   does not.
2. **Reception** — BEFORE fixing (`REV-12`): a fresh read-only critic takes
   the blocker list (summary + authority + location + `evidence`), reads each cited
   authority in full and the cited carriers, rules HOLDS / STRETCH / FALSE
   per blocker (`../artifacts/verdict.md`), writes `$RUN/adjudication.json`;
   then `node tools/review/blockers.mjs "$RUN/verdict.json" "$RUN/adjudication.json"`.
   HOLDS + `missing` rows = FIX; STRETCH / FALSE = REJECT; concerns, nits and
   `weak` rows = NOTE. One journal line for the REJECT/NOTE set (ledger; the
   unit's `## Decisions` without a goal; a no-doc unit records none — the
   settled list rides the verify prompt); the verdict file stays untouched.
   Exit 0 → PASS, nothing to fix.
3. **Stall check** (`STOP-3`): a FIX blocker unchanged since the previous
   verify pass — read from git log, the fix commits of this unit name what
   they closed, so a re-invoked run continues the count → `STOP-4` re-cut
   (once per checkpoint), not another fix; a stall surviving it → the unit
   leaves the path (`STOP-4` 3). Exits of a checkpoint: pass; left-path;
   `STOP-1a` (a fork inside the re-cut, outside a goal); `STOP-1b` (premise,
   `REV-6`); harness (invalid verdict twice).
4. **Batch fix** — one commit fixing ALL FIX findings, its message naming
   them; never weaken a ready contract silently (`RDY-5`); never edit a test
   to pass.
5. **Verify pass** — same command, prior verdicts attached as settled
   (`PRIOR FINDINGS (settled, do not re-raise; report ONLY defects not on this
   list; nothing new → say so in merge_call):` + one-liners). Exit 0 → done:
   Contract+RED writes `ready-verdict:`; Final+GREEN lands (`REV-8`); either
   PASS adds `reviewed_sha` (the commit the reviewer saw) to
   `$RUN/verdict.json` and commits it as
   `docs/backlog/<area>/reference/<slug>-<checkpoint>.json`, the rulings as
   `…-<checkpoint>.adjudication.json` (`REV-8`; `check:contract-drift` binds
   the `ready-verdict:` line to the file). Exit 1
   → back to 2. Exit 2 → the runner retries the reviewer once; a second
   invalid verdict is a harness failure — the run ends with the `STOP-6`
   report, no question.

## Ordinary review

`review: ordinary` units (`RDY-8`): one fresh reviewer (`REV-11`) — the same
`codex exec` invocation without `--output-schema` / `-o`, prompt "Invoke the
rifty-review skill for an ordinary review of $UNIT (a contract path, or the
PR number for a unit with no doc) against BASE $BASE: prose verdict, findings
with severity, authority and file:line, no coverage table". No critic, no
`blockers.mjs`: the driver dispositions each finding inline (`REV-12`) — a
traced row without a discriminating carrier is a FIX citing the row; a
REJECT of a blocker citing a `REV-2` authority goes to a fresh critic first —
fixes the FIX set in one commit naming them, and runs the same reviewer once
more with the settled list attached; no FIX left = PASS at that tree,
committed as `reference/<slug|pr-N>-ordinary.json` (verdict prose, reception
lines, `reviewed_sha`) when product or test paths changed, else posted to the
PR (`REV-8`). A
FIX surviving the second pass is a stall like any other (`STOP-3`): one
re-cut, one more pass (`STOP-4`); surviving that, inside a goal the unit
leaves the path, alone it does not land — one `STOP-6` report.

A PASS holds while every path changed since it is documentation
(`isDocumentationOnlyPath`) and the graded contract is unchanged
(`itemContract`) (`REV-8`); `pnpm check:pass-binding` proves it before merge
and in CI once the PR leaves draft. NOTE and REJECT never seed a unit (`REV-12`); the
agent may still fix a NOTE in place after the verdict.
