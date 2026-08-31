# Decision workflow — reversibility, subagents, backlog

Elaborates `AGENTS.md` §Decisions (`CLAUDE.md` = symlink). Read at any fork. Rule: decide, record, continue — never pause; the checklist picks WHERE to record.

## Reversibility checklist (order matters; first "yes" wins)
1. Cross-package public API → **IRREVERSIBLE** → ADR. Exception: repo-only
   declared internal subpath with a shared consumer suite → reversible backlog
   item; layer rules still apply (`pnpm check:arch`).
2. New external dependency → **IRREVERSIBLE** → ADR.
3. Contradicts an ADR → **IRREVERSIBLE** → §Reconsidering.
4. Live alternatives affecting behavior/parity, a new mechanism, or contested
   policy/default → **IRREVERSIBLE** → ADR. Diff size is irrelevant. A data
   model/authority encoding external-system semantics (npm tree/bins/peers,
   Node identity) carries the contract evidence bar: the ADR cites a pinned
   discriminating probe (command + output + version); a non-discriminating
   probe = frozen assumption. A new-mechanism or data-authority ADR records
   ≥2 radically different candidates — the minimal-interface one among them —
   each kept or killed by named evidence.
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
3. Remaining user-observable fork → leave draft, surface the exact branch, and
   request manual `rifty-refine`; don't interview mid-task.
4. Otherwise compile the contract: every Parity/Fault row carries a reproducible
   artifact — command + output + version; model memory is not evidence; a
   prescribed carrier with no spike/ADR fact = frozen assumption. An open
   blocking `## Challenge` premise problem (value does not follow / cheaper
   direct authority — `docs/backlog/README.md` §Challenge) is answered in the
   doc or overridden by the user on the record; never flip past it. All forks
   resolved + rows evidenced → set `ready`, run `pnpm backlog:check`, continue;
   open fork → step 3; missing/unverifiable evidence → step 1. No «settled with
   caveats». Verification is the unit's Contract+RED checkpoint at pickup (fresh
   reviewer, raw contract, no framing — frame-then-validate voids the check);
   before implementation its verdict is copied VERBATIM as the first line of the
   doc's `## Decisions`: `ready-verdict: <date> — Contract+RED @ <sha>`. One
   fresh context per contract, never two.
5. An unsettled fork discovered in an already-`ready` item (mid-build or review) →
   demote to `draft` recording the fork AND the pre-demotion Acceptance/Parity
   verbatim; the next Contract+RED checkpoint diffs the re-cut against them — any weakening is a
   user-observable fork → manual `rifty-refine`. Never absorb silently. (An
   active goal itself cannot be demoted — a ready `goal.md` never changes;
   amend = close + re-fit.) The
   demotion commits in the discovering PR — pre- or post-pickup;
   `check:contract-drift` allows the `ready`→`draft` flip, the recorded fork +
   verbatim Acceptance stay mandatory.

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

## Goal runs

Data contract (goal/map/ledger, run rules): `docs/backlog/README.md` §Goal run;
procedure per mode: `rifty-goal` (FIT / PICKUP / RE-CHART / CLOSE). Own the
frozen destination, not a prewritten plan: `goal.md` is user-owned; children,
order, mechanisms, and fog are live run state — re-cut them, never the goal.

Run loop — starts only on an explicit whole-ready-goal hand-off; never for
ordinary items, single fixes, or process/docs/skill work:

1. FIT (or inherit a ready goal): destination (invariants + tier, delivered to
   the user as the completion report — backlog README §Report), probe-or-fog
   over every encoded assumption (external semantics + internal scope-carrying
   mappings), specifiable children only.
2. PICKUP one dependency-ready child: compile per §Backlog readiness above;
   declare its ledger band; Contract+RED (fresh isolated reviewer —
   `rifty-review` §Checkpoint run; never the implementer's own pass); then
   implement. Planned work and expected RED never invoke `rifty-fix`.
3. Classify discoveries against the frozen goal/tier/Fidelity: required → goal
   residual (reverse-linked draft child); outside → `rifty-to-backlog`.
4. Band trip or Final+GREEN unit residual → re-cut the unit IN PLACE — same
   branch, attempt + checkpoint count carries. Never a fresh start, never
   narrow the goal or detach required work. Either review-convergence valve
   (Contract escalation, Convergence — `fault-classes.md`) ends the round loop
   with a stop to the user, never round N+1; raising a round budget to get past
   one is not an agent decision.
5. Unit clean → merge, then RE-CHART: graduate touched fog into draft children;
   re-cut or delete unpicked items the new facts invalidated; append learned
   one-liners to the ledger.
6. Map empty + `## Invariants` proven end-to-end → CLOSE: walk the ledger —
   every line exports to a durable carrier or gets an explicit drop — then
   delete the goal directory whole.

Show any conflict with the destination against its exact clause.

Claude sessions may execute steps 2–6 deterministically via the `goal-run`
workflow (`.claude/workflows/goal-run.js`): slice loop until the map is empty,
then CLOSE; any user-owned decision (fork → `rifty-refine`, a fired
review-convergence valve, slice cap) returns a structured stop — resolve it and
re-invoke, done stages skip off disk state. The valves take no budget argument
by design. The skills stay canon — the script owns only
order, gates, and bookkeeping checks, its prompts point at the skill files.
FIT stays an inline skill (interactive: forks).

While a goal is in a run the invoking session is an observer: it launches or
re-invokes the run and relays statuses/stops in brief; it never edits tracked
files — a hand edit bypasses checkpoint lineage and voids tree-bound verdicts.
Sole exception: executing the named stop-resolution with the user
(`rifty-refine`); everything else is a re-invoke — the run's agents do the
work.
