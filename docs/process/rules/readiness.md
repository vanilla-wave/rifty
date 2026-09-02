# Readiness — draft → ready, trace, size, re-cut (`RDY`)

Shape of the artifacts: `../artifacts/unit.md`, `../artifacts/goal.md`. Never
implement a draft.

## RDY-1 When

The hand-off boundary is the ready `goal.md`, NOT a ready item: a goal is
handed off with its children still `draft`; each child compiles here at its own
PICKUP, JIT, one at a time. FIT never compiles a child. Outside a goal run a
settled draft may compile at intake. Either way the verdict is the unit's
Contract+RED at pickup — item `ready` is a per-slice event inside the run,
never a precondition for starting one.

## RDY-2 Compile

1. Exhaust code, ADR, real-Node, and disposable-spike evidence.
2. Resolve internal forks yourself. A missing section is not a reason to
   invoke a skill.
3. Remaining user-observable fork → leave draft, surface the exact branch,
   request manual `rifty-refine`; never interview mid-task.
4. Every Parity/Fault row carries a reproducible artifact — command + output +
   version; model memory is not evidence; a prescribed carrier with no
   spike/ADR fact = frozen assumption. An open blocking `## Challenge` premise
   problem (value does not follow / cheaper direct authority —
   `docs/backlog/README.md` §Challenge) is answered in the doc or overridden
   by the user on the record; never flip past it.
5. All forks resolved + rows evidenced + `RDY-3`/`RDY-4` satisfied → set
   `ready`, run `pnpm backlog:check`, continue. No «settled with caveats».
   Verification is the unit's Contract+RED at pickup (fresh reviewer, raw
   contract, no framing — frame-then-validate voids the check); its verdict is
   copied VERBATIM as the first line of `## Decisions`:
   `ready-verdict: <date> — Contract+RED @ <sha>`. One fresh context per
   contract, never two.

## RDY-3 Trace — obligations come from the destination

Every `## Acceptance` / `## Parity cases` row and every `## Fault matrix` row
ends with a trace: `→ I3`, `→ scenario`, `→ ADR-0375`, `→ REV-7`, or several.
The trace names WHY the row exists: an invariant, a `## User scenario` line, an
ADR, or a rule id. Trace targets are the only declared authorities a review may
block on (`review.md` `REV-2`).

An untraced row is a carrier note: it raises no coverage row and no blocker.
Wanting a row to bind = find its trace; none exists = it is not an obligation.
Machine gate: `backlog:check` requires traces on ready items `created ≥
2026-09-02`; older ready items get traces at their next re-cut.

## RDY-4 Size — one intent, one session

A ready unit is one intent its `title` states in one sentence. Limits, gated by
`backlog:check` for items `created ≥ 2026-09-02`: ≤ 15 traced rows, body ≤ 200
lines. Over either → split at PICKUP, before any review. Run state never lives
in the contract: evidence blocks (command + output) go to
`docs/backlog/<area>/reference/<slug>-evidence.md`, fork narratives and
diagnoses to the ledger or `reference/`; `## Decisions` holds one-line records
only (`../artifacts/unit.md`). "Sufficient, not exhaustive": a clause the
scenario does not need is a clause the reviewer will grade.

## RDY-5 Re-cut — the path is the agent's

A ready unit may be re-cut at any time by the agent: trim, split, merge,
re-order, demote rows to notes. Record one line in `## Decisions`
(`re-cut: <date> — <what changed> — trace: none`) and one ledger line; a split
successor names its predecessor in that line — history stays on the
predecessor, nothing is copied (`review.md` `REV-8`).

Dropping or weakening a row traced to `I#` or `scenario` changes observable
scope: that is the user's (`STOP-1a`) — demote to `draft`, record the fork and
the pre-demotion row verbatim, request manual `rifty-refine`; the resolution
lands as `re-cut: <date> — fork: <what> — trace: I#`. Never absorb silently.
Rows traced only to ADRs/rules and untraced rows are agent-owned.
`check:contract-drift` enforces: a ready contract changed beside source carries
a `re-cut:` line; a user-traced row (`→ I#`, `→ scenario`) changed carries
`fork:` in it. The active `goal.md` is never re-cut — amend = CLOSE + FIT.

## RDY-6 Refine altitude

The user owns observable scope; the agent owns carriers (cache placement, wire
shape, tokens, storage layout). A carrier enters a contract only as a
constraint, an ADR choice, or a disposable-spike fact. Keep spike evidence;
discard spike code.

## RDY-7 Reachability

Own-product work without an external oracle needs a user-action repro path.
Without one, record the attempt and keep `draft`. Inject only faults physically
allowed by `fault-classes.md` §Boundary failure models and within the epic
tier. Raising tier requires an ADR.

## RDY-8 Review membership

Decided ONCE at pickup per unit from its OWN subject, recorded in the unit doc:
parity, cache, persistence, network, or concurrency → `review: checkpoints
rounds:<n>`; docs/CI/process/tooling/harness → `review: ordinary` (one review
after implementation, blockers fixed in place, no lineage). A loop that
checkpoints every child regardless is the defect that put a CI unit through 12
rounds (2026-08-30, `no-coi-substrate-lane`).

## RDY-9 Budget

At pickup the ledger row declares band + rounds: `<date> — <slice> band
<lo>–<hi> rounds <n>` (`../artifacts/ledger.md`). Band = the size of the
expected-RED batch the compiled contract implies. `rounds` is the Final+GREEN
budget (default 2); Contract+RED has exactly one verify round by construction
— a 2nd blocker there is contract escalation (`stops.md` `STOP-5`). Raising a
declared budget is the user's, never the agent's (`STOP-2`). A unit picked up
before 2026-09-02 carries no `rounds:` line: the default applies, the reviewer
notes its absence as a concern, and the next re-cut adds the line — never a
blocker (replay 2026-09-02: the legacy `build-loop` unit drew one).

A split successor that only carries rows and RED tests already certified in
its predecessor's Contract+RED skips that checkpoint: first `## Decisions` line
`ready-verdict: <date> — inherited from <predecessor> @ <sha>`. A successor
minted by `STOP-4` starts with its `re-cut:` line, so the one re-cut of the
lineage is already spent. Band ≤ 4 → each checkpoint is one find pass +
adjudication, no tail pass.
