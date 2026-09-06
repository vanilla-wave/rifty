# Readiness — draft → ready, trace, size, re-cut (`RDY`)

Shape of the artifacts: `../artifacts/unit.md`, `../artifacts/goal.md`. Never
implement a draft. Removed id (2026-09-05): `RDY-9` band + rounds budget —
nothing numeric is declared at pickup.

## RDY-1 When

PICKUP compiles one unit, JIT: inside a goal the frontier child (the hand-off
boundary is the ready `goal.md`; children stay `draft` until their own PICKUP;
FIT never compiles a child), outside a goal the item itself. The verdict is
the unit's Contract+RED at pickup — item `ready` is a per-unit event, never a
precondition for starting.

## RDY-2 Compile

1. Exhaust code, ADR, real-Node, and disposable-spike evidence.
2. Resolve internal forks yourself. A missing section is not a reason to
   invoke a skill.
3. Remaining user-observable fork → leave draft, surface the exact branch,
   request manual `rifty-refine`; never interview mid-task.
4. Every Parity/Fault row carries a reproducible artifact — command + output +
   version; model memory is not evidence; a prescribed carrier with no
   spike/ADR fact = frozen assumption. Evidence is about the ORACLE and the
   baseline (real Node, the current product, a disposable spike), never about
   the deliverable: a number that exists only once the unit is built (its own
   cold start, its own lane time) is an Acceptance row traced to `I#` /
   `scenario`, whose artifact is the RED that IMPLEMENT turns green. A spike
   that is the deliverable is implementation. A "go/no-go at pickup" that
   depends on measuring the deliverable is a premise question — FIT/refine
   (`review.md` `REV-6`), not a pickup step (2026-09-02
   `react-vite-starter`: the tile was built inside pickup to measure it). An
   open blocking `## Challenge` premise problem (value does not follow /
   cheaper direct authority — `docs/backlog/README.md` §Challenge) is answered
   in the doc or overridden by the user on the record; never flip past it.
5. All forks resolved + rows evidenced + `RDY-3`/`RDY-4` satisfied → set
   `ready`, run `pnpm backlog:check`, continue. No «settled with caveats». A
   **question** draft ("is this mechanism still load-bearing?") whose probe of
   the current product answers "keep it" is not compiled: it is declined here
   — one `docs/adr/README.md` §Declined concepts row citing the probe, draft
   deleted; "retire it" compiles like any unit (membership `RDY-8`; a
   repo-wide removal is one CHANGELOG line, `DEC-1` 5).
   Verification is the unit's Contract+RED at pickup (fresh reviewer, raw
   contract, no framing — frame-then-validate voids the check); its verdict is
   copied VERBATIM as the first line of `## Decisions`:
   `ready-verdict: <date> — Contract+RED @ <sha>`.

## RDY-3 Trace — obligations come from the destination

Every `## Acceptance` / `## Parity cases` row and every `## Fault matrix` row
ends with a trace: `→ I3`, `→ scenario`, `→ ADR-0375`, or several. The trace
names WHY the row exists: an invariant, a `## User scenario` line, or an ADR.
Trace targets are the only declared authorities a review may block on
(`review.md` `REV-2`). A trace holds only when the target clause states the
property the row asserts — the `REV-3` exactness test, applied at compile:
`→ I2` ("installs the real Vite 7 set") does not carry "rejected overlap has
zero dispatch"; that row is a note until an invariant or scenario line names
the property.

An untraced row is a carrier note: it raises no coverage row and no blocker. A
row traced only to a rule id (`→ REV-7`, `→ DEC-2`) is a carrier note too —
the syntax stays legal for `backlog:check`, but rule compliance is graded as a
concern (`review.md` `REV-3`), never as coverage; the only rules that block
are the ones `REV-2` lists. Wanting a row to bind = find its trace; none
exists = it is not an obligation.
Machine gate: `backlog:check` requires traces on ready items `created ≥
2026-09-03`; older ready items get traces at their next re-cut.

## RDY-4 Size — one intent, one session

A ready unit is one intent its `title` states in one sentence; two intents are
two units (`RDY-5` split, the agent's). Run state never lives in the contract:
evidence blocks (command + output) go to
`docs/backlog/<area>/reference/<slug>-evidence.md`, fork narratives and
diagnoses to the ledger or `reference/`; `## Decisions` holds one-line records
only (`../artifacts/unit.md`). "Sufficient, not exhaustive": a clause the
scenario does not need is a clause the reviewer will grade — and `REV-2`
already bounds what a reviewer may block on. No row or line count gates
readiness: the 15-row / 200-line gate (2026-09-02…05) only manufactured
splits, each a checkpoint lineage of its own, and cut the one chokepoint
`fault-classes.md` §Class-kill says to keep whole. Size is a reviewer concern
(`REV-3`).

## RDY-5 Re-cut — the path is the agent's

A ready unit may be re-cut at any time by the agent: trim, split, merge,
re-order, demote rows to notes. Record one line in `## Decisions`
(`re-cut: <date> — <what changed> — trace: none`) and, inside a goal, one
ledger line; a split
successor names its predecessor in that line — history stays on the
predecessor, nothing is copied (`review.md` `REV-8`). A successor that only
carries rows and RED tests already certified in its predecessor's
Contract+RED skips that checkpoint: first `## Decisions` line
`ready-verdict: <date> — inherited from <predecessor> @ <sha>`.

Dropping or weakening a row traced to `I#` or `scenario` changes observable
scope: that is the user's (`STOP-1a`) — demote to `draft`, record the fork and
the pre-demotion row verbatim as one dated `## Decisions` line (any
wording), request manual `rifty-refine`; the resolution lands as `re-cut:
<date> — fork: <what> — trace: I#` and the unit compiles again at PICKUP
(inheritance where only certified rows carry). Never absorb silently. Rows traced only to ADRs/rules and untraced rows are agent-owned.
`check:contract-drift` enforces one fact: a ready contract (status + graded
sections) changed beside source carries a `re-cut:` line; whether a changed
user-traced row needed a `fork:` is review's (`review.md` `REV-10` axis 3).
The active `goal.md` is never re-cut — amend = CLOSE + FIT.

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

Two values, one line in `## Decisions` at pickup: `review: checkpoints |
ordinary`. A unit has a contract doc when it has obligations to trace
(`RDY-3`). It is `checkpoints` when those obligations are product behavior
to build — parity, cache, persistence, network, concurrency: Contract+RED
before code, Final+GREEN after. It records `ordinary` when they are proof
about landed behavior (test carriers, evidence, a mechanism record, an ADR)
or its subject is docs, CI, process, tooling or harness. A unit with nothing
to trace has no doc at all and is `ordinary` by construction: a defect fix
(its RED test is the proof — `rifty-fix`), a docs change, a CHANGELOG line,
a CI rule; nothing is minted for it and nothing is journaled beyond its PR
(`pr.md` `PR-2`).

`ordinary` = one fresh review after implementation (`review.md` `REV-11`,
`../stages/checkpoint-run.md` §Ordinary review), findings dispositioned
inline (`REV-12`), the FIX set fixed once and verified by the same reviewer;
no machine verdict, no lineage; a traced row the reviewer finds without a
discriminating carrier is a FIX finding citing that row (`REV-4`), a product
change inside a proof unit is `REV-1` scope. A loop that
checkpoints every child regardless is the defect that put a CI unit through
12 rounds (2026-08-30, `no-coi-substrate-lane`).
