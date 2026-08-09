# Decision workflow — reversibility, subagents, backlog

Elaborates `AGENTS.md` §Decisions (`CLAUDE.md` = symlink). Read at any fork. Rule: decide, record, continue — never pause; the checklist picks WHERE to record.

## Reversibility checklist (order matters; first "yes" wins)
1. Cross-package public API → **IRREVERSIBLE** → ADR. Exception: repo-only
   declared internal subpath with a shared consumer suite → reversible backlog
   item; layer rules still apply (`pnpm check:arch`).
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
3. Remaining user-observable fork → leave draft, surface the exact branch, and
   request manual `rifty-refine`; don't interview mid-task.
4. Otherwise compile the contract: every Parity/Fault row carries a reproducible
   artifact — command + output + version; model memory is not evidence; a
   prescribed carrier with no spike/ADR fact = frozen assumption. All forks
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
   active goal epic itself cannot be demoted — `check:goal-contract`.) The
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

## Autonomous goals

Data contract (marker, Budget, residuals, closure): `docs/backlog/README.md`
§Autonomous goal. Own the frozen outcome, not a prewritten plan. At a fork, the
only extra rule: the user owns frozen observable fields; re-cut live
items/order/mechanisms, never the goal or its required reverse-linked work.

Run loop — starts only on an explicit whole-ready-epic hand-off or a task/PR
carrying `Goal-Baseline`; never for ordinary items, single fixes, or
process/docs/skill work:

1. Bootstrap or inherit the write-once marker (bootstrap = ONE contract-only PR:
   epic commit, then marker-only commit pointing at it — never a chain of PRs);
   declare the matching `Goal-Baseline` and one `Budget-Slice`.
2. Pick one dependency-ready residual; compile a settled draft per §Backlog
   readiness above; surface only a remaining observable fork for manual
   `rifty-refine`.
3. Run Contract+RED (fresh isolated reviewer — `rifty-review` §Checkpoint run;
   never the implementer's own pass), then implement the ready unit. Planned work
   and expected RED never invoke `rifty-fix`.
4. Classify discoveries against the frozen goal/tier/Fidelity: required →
   reverse-linked goal residual; outside → `rifty-to-backlog`.
5. Budget trip or Final+GREEN unit residual → re-cut the unit: shrink/split its
   boundary IN PLACE — same branch, attempt + checkpoint count carries. Never a
   fresh start, never narrow the goal, detach required work, or auto-fix.
6. Unit clean with goal residuals → close only that unit and continue.
7. Close per `docs/backlog/README.md` §Autonomous goal — incl. end-to-end proof
   of the baseline `## Invariants`; then delete the epic.

Show any conflict with the baseline against its exact clause.
