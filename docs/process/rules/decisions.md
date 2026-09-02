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

Overturning an active ADR/dependency gets a decision subagent and a superseding
ADR. Remove the old ADR, preserve load-bearing context in the successor, add
the old→new pointer to `docs/adr/README.md`.

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

One role per session (`../README.md` §Roles). A decision leaves a session only
through the journal (ledger line, verdict line, `## Decisions` line) — written
before it can fall out of context. Long-running children (reviewer, test
battery) run as background tasks with a completion notification; the waiting
session works or sleeps ≥ 20 min, never polls per minute.
