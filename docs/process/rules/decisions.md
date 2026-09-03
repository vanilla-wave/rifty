# Decisions — decide, record, continue (`DEC`)

Never pause to ask; the checklist picks WHERE to record. Stops to the user are
the closed list in `stops.md` (`STOP-1`), nothing else.

## DEC-1 Reversibility (first "yes" wins)

1. Cross-package public API → **IRREVERSIBLE** → ADR. Exception: repo-only
   declared internal subpath with a shared consumer suite → reversible backlog
   item; layer rules still apply (`pnpm check:arch`).
2. New external dependency → **IRREVERSIBLE** → ADR.
3. Contradicts an ADR → **IRREVERSIBLE** → `DEC-2`.
4. Live alternatives affecting behavior/parity, a new mechanism, or contested
   policy/default → **IRREVERSIBLE** → ADR. Diff size is irrelevant. A data
   model/authority encoding external-system semantics (npm tree/bins/peers,
   Node identity) cites a pinned discriminating probe (command + output +
   version); a non-discriminating probe = frozen assumption. A new-mechanism or
   data-authority ADR records ≥2 radically different candidates — the
   minimal-interface one among them — each kept or killed by named evidence.
5. Otherwise **REVERSIBLE**: contract-stable change → CHANGELOG; provisional
   judgment → backlog item + `// TODO(backlog: <area>/<slug>)`.

Process decisions are not ADRs: they land in `docs/process` + a CHANGELOG line
naming what they overturn.

## DEC-2 Reconsidering a recorded decision

Adding a decision on a seam an ADR already owns is not reconsidering: a new
short ADR citing the prior one — nothing removed, nothing grafted. Overturning
an active ADR/dependency gets a decision subagent and a superseding ADR that
names the overturned decisions by number. All overturned → remove the old ADR,
add the old→new pointer to `docs/adr/README.md`; some → the old ADR stays
active with a dated note under §Corrections (active) pointing at the
successor. What was not overturned was not moved: graft completeness is never
a review finding.

## DEC-3 Confirm-first

Only: publish, spend, delete user data. Everything else is pre-authorized;
merge permission persists once given. The closed list of run stops is
`stops.md` `STOP-1`.

## DEC-4 Subagent budget

- OK for: independent research, review, verification, scoped implementation.
- Max depth 1 default; 2+ needs explicit current-task permission; depth 3
  read-only only (research/audit/verify/map-reduce); >3 forbidden w/o user
  override.
- Subagent prompt states: depth, max depth, children yes/no, mode
  (read-only/code-edit), owned scope.
- Leaves never spawn children — report need upward.
- Code-editing agents: disjoint file/module ownership; never revert/overwrite
  others' work. Parent owns integration, architecture calls, final verification.

## DEC-5 Session hygiene

Fresh isolated context is required only where the fresh context is the
evidence: reviewer and critic/adjudicator (`review.md` `REV-11`) — always a
fresh `codex exec` or subagent, read-only. Orchestrator, worker and runner are
one driver: on a hand-off, the interactive session itself; one fresh session
per stage only where a harness driver exists (`.claude/workflows/goal-run.js`).
A decision leaves a session only through the journal (ledger line, verdict
line, `## Decisions` line) — written before it can fall out of context; the
journal, not a session boundary, is what survives compaction.

Waiting on a child (reviewer, test battery) is harness-bound:

- Claude: background task + completion notification; never poll.
- Codex: `exec_command` is clamped at 30 s and an empty `write_stdin` at 300 s
  (`MAX_YIELD_TIME_MS`, `DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS`), and
  unified-exec children die when the turn ends — so the turn stays open and
  waits with one `write_stdin({chars:"", yield_time_ms:300000})` per 5 min,
  nothing between polls: no status message, no log read, no `ps`.

A wait has no deadline: liveness is the process state, never elapsed time.
