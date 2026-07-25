# Decision workflow — reversibility, subagents, backlog

Elaborates `AGENTS.md` §Decisions (`CLAUDE.md` = symlink). Read at any fork. Rule: decide, record, continue — never pause. Checklist picks WHERE to record, never whether to stop.

## Reversibility checklist (order matters; first "yes" wins)
1. Cross-package public API → **IRREVERSIBLE** → ADR. Exception: repo-only
   declared internal subpath with a shared consumer suite → reversible backlog
   item; layer rules still apply (`fault-classes.md` §Class-kill).
2. New external dependency → **IRREVERSIBLE** → ADR.
3. Contradicts an ADR → **IRREVERSIBLE** → §Reconsidering.
4. Live alternatives affecting behavior/parity, a new mechanism, or contested
   policy/default → **IRREVERSIBLE** → ADR. Diff size is irrelevant.
5. Otherwise **REVERSIBLE**: contract-stable change → CHANGELOG; provisional
   judgment → backlog item + `// TODO(backlog: <area>/<slug>)`.

## Reconsidering a recorded decision
Overturning an active ADR/dependency gets a decision subagent and superseding
ADR. Remove the old ADR, preserve load-bearing context in the successor, and add
the old→new pointer to `docs/adr/README.md`.

## Subagent budget
- OK for: independent research, review, verification, scoped implementation.
- Max depth 1 default; 2+ needs explicit current-task permission; depth 3 read-only only (research/audit/verify/map-reduce); >3 forbidden w/o user override.
- Subagent prompt states: depth, max depth, children yes/no, mode (read-only/code-edit), owned scope.
- Leaves never spawn children — report need upward.
- Code-editing agents: disjoint file/module ownership; never revert/overwrite others' work. Parent owns integration, architecture calls, final verification.

## Backlog readiness (draft → ready)

Shape and validation: `docs/backlog/README.md`. Never implement a draft.

1. Exhaust code, ADR, real-Node, and disposable-spike evidence.
2. Resolve internal forks yourself. A missing section is not a reason to invoke a skill.
3. Remaining user-observable fork → leave draft and request manual `rifty-refine`.
4. Otherwise compile the contract, set `ready`, run `pnpm backlog:check`, continue.

### Refine altitude

The user owns observable scope; the agent owns carriers such as cache placement,
wire shape, tokens, and storage layout. Put a carrier in a contract only as a
constraint, an ADR choice, or a disposable-spike fact. Keep spike evidence;
discard spike code.

### Reachability

Own-product work without an external oracle needs a user-action repro path.
Without one, record the attempt and keep `draft`. Inject only faults physically
allowed by `fault-classes.md` §Boundary failure models and within the epic tier.
Raising tier requires an ADR.

## Autonomous goals

Marker, Budget, residual, and closure rules live in `docs/backlog/README.md`
§Autonomous goal; execution lives in `rifty-goal-run`. At a fork, the only extra
decision rule is: the user owns frozen observable fields; re-cut live
items/order/mechanisms, never the goal or its required reverse-linked work.
