# Readiness — draft → ready, trace, size, re-cut (`RDY`)

Shape of the artifacts: `../artifacts/unit.md`, `../artifacts/goal.md`. Never
implement a draft. Removed id (2026-09-05): `RDY-9` band + rounds budget —
nothing numeric is declared at pickup.

## RDY-1 When

PICKUP identifies the accepted result and missing evidence for any authorized
change. A goal's children compile just in time; FIT sets the destination,
not every implementation contract. A draft can be captured without review.
Do not implement an unsettled promise: prepare it by `RDY-2`/`RDY-8` first.

## RDY-2 Compile

1. Exhaust code, ADR, real-Node and disposable-spike evidence. Resolve internal
   choices yourself; ask only for an unresolved user-observable choice.
2. Record the scenario, acceptance, applicable parity/fault cases and their
   authority. Oracle claims carry command + output + version. A value measurable
   only after implementation becomes an acceptance target, not a fabricated
   pickup measurement. A spike that is the deliverable is implementation.
3. Before adopting a new plan, resolve any missing premise check per
   `docs/backlog/README.md` §Challenge. Reuse an early refine check or the goal's
   accepted premise for unchanged promises; otherwise the Contract+RED reviewer
   may perform it in the same pass. Preserve the verdict and its evidence;
   record `challenge: <date> — clear | N problems` in the ready doc.
   Resolve value/cheaper-route objections with evidence or the user's recorded
   decision; never re-litigate settled scope without new evidence.
4. Obtain the preparation required by `RDY-8`, set an existing draft ready,
   run `backlog:check`, continue. A question answered by a probe may be closed
   here; no need to compile a declined plan or invent a second delivery.

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
(`re-cut: <date> — <what changed> — trace: none`) with a link from the goal ledger when it changes the route; a split
successor names its predecessor in that line — history stays on the
predecessor, nothing is copied (`review.md` `REV-8`). A successor that only
carries rows and RED tests already certified in its predecessor's
Contract+RED skips that checkpoint: first `## Decisions` line
`ready-verdict: <date> — inherited from <predecessor> @ <sha>`.

Dropping or weakening a row traced to `I#` or `scenario` changes observable
scope: that is the user's (`STOP-1a`) — demote to `draft`, record the fork and
the pre-demotion row verbatim as one dated `## Decisions` line (any
wording), ask the user using `rifty-refine` in this session; the resolution lands as `re-cut:
<date> — fork: <what> — trace: I#` and the unit compiles again at PICKUP
(inheritance where only certified rows carry). Never absorb silently. Rows traced only to ADRs/rules and untraced rows are agent-owned;
an ADR-traced row leaves only with the ADR named in the `re-cut:` line.
`check:contract-drift` enforces: a ready contract (status + graded sections)
changed beside source carries a `re-cut:` line; fewer user-traced rows need
`fork:` on that line, fewer ADR-traced rows the ADR named; whether a reworded
row was weakened is review's (`review.md` `REV-10` axis 3).
The goal changes only by a user amendment (`RDY-6`).

## RDY-6 Authority and amendments

The user owns observable scope; the agent owns carriers and implementation.

### Establishing scope

Before claiming refinement settled or setting a promise ready, check its
material assumptions against the original user request and answers, not only
the scenario the agent wrote. An empty known question frontier is not that check.

1. Walk the requested actions and their reachable interactions/transitions:
   what existing user state meets new input, repeated use or changed settings?
   Inspect material defaults, exclusions and meanings hidden in technical terms.
   No full state cross-product or implementation design is required.
2. Try two outcomes allowed by the draft's words. A difference is a user fork
   only when it is reachable, materially affects the requested value, and no
   accepted decision or applicable ADR/reference/baseline already settles it.
   Name the action, difference and source of that value. Otherwise resolve it
   as an internal choice or an unrelated suggestion; never manufacture scope.
   A probe establishes current behavior, not consent to a new policy. An
   agent-written exclusion or narrower fixture cannot supply user authority.
3. Keep a compact source → observable consequence → authority or open owner
   record for material assumptions in existing Decisions/evidence/map locations.
   Cite actual user answers or the clause/probe and why it applies. Reuse valid
   records for unchanged scope; baseline-only work needs no invented interview.
   A just-file capture may retain open questions without claiming scope settled.
4. Ask the informed independent frontier together. After an answer or new fact,
   revisit affected assumptions and dependent choices before closure. A live
   unresolved user choice cannot be declared settled or compiled into a ready
   promise; dependent work waits, independent work continues (`STOP-1`).
   Route-only unknowns remain agent-owned fog; unknowable user questions follow
   FIT's fog rule and cannot be used to invent a destination-changing answer.

This is evidence within existing preparation, not another stage, review quota
or approval. The existing Challenge independently checks this evidence against
raw input when applicable (`docs/backlog/README.md` §Challenge). Later facts may
open new forks; report the checked scope and remaining uncertainty, never a
guarantee that no future choice exists. Machines validate records, not completeness.

### Amendments

A user decision may amend a ready goal in place. Record in `## Decisions`:
`amend: <date> — user: <their words> — <changed obligations and why>`.
Keep prior evidence/history; rechart dependencies and independently recheck
changed promises before implementing them (`RDY-8`). Unchanged obligations
keep valid evidence. No CLOSE + FIT and no repeated approval of the same choice.
An amendment record proves attribution; review verifies actual authorization.
Silence, a technical failure, an ADR or a new reviewer demand is not user consent.
Carrier constraints require an ADR choice or a discriminating spike artifact.

## RDY-7 Reachability

Own-product work without an external oracle needs a user-action repro path.
Without one, record the attempt and keep `draft`. Inject only faults physically
allowed by `fault-classes.md` §Boundary failure models and within the epic
tier. Raising tier requires an ADR.

## RDY-8 Preparation follows missing evidence

There is one review route and one verdict model (`REV-8`). Before implementing:

- A new parity/stateful promise needs independent Contract+RED: the reference
  behavior and discriminating REDs, then Final+GREEN after implementation.
- An observed defect already has a contract in the real Node/existing baseline.
  Capture that artifact, execute its RED, fix the root cause, then Final+GREEN.
  A fix label never excuses a speculative oracle or an untested change.
- Proof for landed behavior reuses its accepted authority. Verify the new
  proof discriminates; no new-behavior checkpoint merely because it has a doc.
- Docs/CI/process/tooling need relevant checks and Final+GREEN. Any product
  behavior they introduce follows the first two rules, wherever the file lives.

No `review: ordinary|checkpoints` membership declaration. Legacy labels and
verdict lines are history; preparation is established by their actual evidence.
A doc exists when useful for obligations; it never grants or removes a gate.
