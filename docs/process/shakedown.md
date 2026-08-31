# Shakedown — the process rehearsed against itself

Regression suite for the *process*, not the code. Each cell walks a real seed
through the written process on paper; a step with no clause is **silence** (each
agent improvises, no two runs match). Re-run: report what newly fails / newly
passes, never a fresh opinion. A lesson paid for in a real run enters here as a
cell, once.

Run 1 — 2026-08-31 @ `27442ae05`. 12 cells, 9 failed.

## Map

Process text an agent is bound by: `AGENTS.md` (68) · `docs/process/`
{`decision-workflow` 121, `fault-classes` 74, `traps` 78, `testing` 21} ·
`docs/backlog/README.md` (160) + `TEMPLATE.md` · `docs/adr/README.md` (523) ·
`.agents/skills/*/SKILL.md` ×5 (310) · `rifty-goal/{FIT,PICKUP,RECHART,CLOSE}.md`
(119) · `.claude/workflows/goal-run.js` (138). **16 files, ~1470 lines.**

### Doors

| Intent | Clause |
|---|---|
| user-brought idea/finding, in session | `AGENTS.md:30` → `rifty-refine` |
| mid-task / agent discovery | `AGENTS.md:30` → `rifty-to-backlog` |
| observed unexpected failure (regression, flake, defect) | `rifty-fix/SKILL.md:3` — **not named in `AGENTS.md:30`**, which mentions `rifty-fix` only as a prohibition |
| whole-ready-goal hand-off | `AGENTS.md:48-50`, `decision-workflow.md:83-84` |
| ready item → implement | `AGENTS.md:30` |
| epic missing tier/Invariants | `AGENTS.md:30` → `rifty-goal` FIT |
| PR review | `AGENTS.md:30` → `rifty-review` |
| doc drift | `rifty-to-backlog/SKILL.md:13` |
| **change a process rule / skill** | **silence.** Nearest: `rifty-refine/SKILL.md:27` (no real software unblocked → `process-meta`), `rifty-review/SKILL.md:22-24` (assumes such PRs exist, never says how one starts) |
| **CI / toolchain change that is not a defect** | **silence.** Nearest: `rifty-to-backlog/SKILL.md:13` "tooling debt → backlog" |

`AGENTS.md:30` is the door directory: one sentence, 10 conditional clauses.

### Stages

raw → `draft` (`rifty-to-backlog/SKILL.md:38-45`) → `ready`
(`decision-workflow.md:34-60`) → PICKUP (`PICKUP.md:1-20`) → Contract+RED
(`decision-workflow.md:90-93`) → implement (`PICKUP.md:18`, `goal-run.js:108`) →
Final+GREEN (`fault-classes.md:70`) → RECHART (`RECHART.md:20-22`) → merge
(`backlog/README.md:129-130`) → CLOSE (`CLOSE.md`).

### Gates

`pnpm pr:check` 24 tasks sequential incl. `test:run`+`test:parity`, no scope
filter (`AGENTS.md:64`, `tools/checks/pr-check.mjs:57-83`) · `backlog:check`,
`check:contract-drift` (`backlog/README.md:140-141`) · Contract+RED and
Final+GREEN checkpoints (`AGENTS.md:16`, `fault-classes.md:70`) · adjudication
(`rifty-review/SKILL.md:91-106`) · Challenge critic, advisory
(`backlog/README.md:62-77`) · DoD, 8 unconditional boxes (`AGENTS.md:60-68`) ·
attempt cap → §Contract escalation (`fault-classes.md:72`) · merge is the user's
(`goal-run.js:138`). CI gates heavy lanes on change scope
(`.github/workflows/ci.yml:76`); `pr:check` does not. `main` is unprotected
(`traps.md:31`).

### Handoffs

user→agent grill (`rifty-refine/SKILL.md:21-33`) · agent→fresh reviewer, per
checkpoint: find, tail, adjudicator, verify (`rifty-review/SKILL.md:33,75,88,91`)
· agent→fresh critic per minted doc (`backlog/README.md:65-66`) · agent→fresh
report subagent (`rifty-to-backlog/SKILL.md:58-60`) · agent→CI · run→observer
session (`decision-workflow.md:116-121`) · workflow→user stop
(`goal-run.js:16`).

## Grid

Tally: docs to read / fresh contexts / PRs / user turns / waits.

| # | archetype · shape · certainty | seed | persona · want | verdict |
|---|---|---|---|---|
| C1 | tiny bug · thick logic · known | PR #272 | agent on red `main` · green in an hour | **fail** |
| C2 | process/docs · trivial edit · known | PR #269 | agent recording a shipped behavior · 4 lines landed | **fail** |
| C3 | process change · trivial edit · known | PR #285 | owner spotting a missing report field · fixed now | **fail** |
| C4 | process change · wide integration · settles | PR #284 | owner killing a gate that stalled runs · gate gone | **fail** |
| C5 | CI/toolchain · wide integration · known | PR #252 | maintainer wiring a release lane · lockstep release | pass |
| C6 | large epic · wide integration · settles | `epics/no-coi-sandbox-tier` | owner handing off the goal · run to close | **fail** |
| C7 | large epic · unknown · settles | `epics/open-auditable-launch.md` | owner: "do this epic" · slices landing | **fail** |
| C8 | small feature · thick logic · known | PR #275 | implementer taking the next ready item · merged slice | pass |
| C9 | review follow-up · unknown · settles | PR #288 Final+GREEN concern | implementer holding 4 concerns after a pass · them handled | **fail** |
| C10 | toolchain · thick logic · settles | PR #288 | agent clearing the file-size ratchet pin · move-only refactor merged | **fail** |
| C11 | small feature · unknown · settles | PR #283 | user with an idea in session · captured and started | pass |
| C12 | tiny bug · unknown · settles | `process-meta/pr-check-vitest-resource-starvation.md` | contributor whose mandatory gate dies without an assertion · a gate that tells regression from starvation | **fail** |

No cell is invented; every seed is a merged PR or a live backlog file.

## Traces (condensed)

**C1** `rifty-fix/SKILL.md:12-17` walks root cause → class → RED → fix → prove.
Step 2 demands a fault axis for every repair; nothing exempts a wrong constant
(`fault-classes.md:3` exempts only goal/process blockers) — improvisation. The
unit touches the network boundary, so `fault-classes.md:61` puts it under review
convergence: Contract+RED before implementation. `rifty-fix` has no checkpoint
step and nothing says its RED satisfies one. **Silence, resolved two ways in
the wild:** #272 ran no checkpoint; #267 (same skill, storage boundary) ran one.
`rifty-fix/SKILL.md:17` requires the class-kill chokepoint to stay in the unit;
#272 pushed it to `toolchain-build/committed-lockfile-registry-host-guard` —
still `draft`, 12 days. Tally 5/0/1/2/2.

**C2** #269 = 4 changelog lines. DoD (`AGENTS.md:64`) runs the whole 26-check
gate: `test:run` 211.9 s + parity 69.3 s. `AGENTS.md:55` says work too small to
review alone rides with the next delivery — no clause defines the threshold, so
it got its own PR. Open→merge 40 h. Tally 5/0/1/2/3.

**C3** Door silence. Improvised as an ordinary PR; 4 commits refining the report
form, full `pr:check`, own PR. The written route (`rifty-refine/SKILL.md:27` →
`process-meta`) leads to a queue with 17 items ever added, 4 ever deleted, 1
since 2026-06-15. Tally 4/0/1/2/2.

**C4** Removing the goal signoff gate is a contested policy/default →
`decision-workflow.md:12-13` says IRREVERSIBLE → ADR. The checklist's subjects
are code (API, dependency, mechanism, policy/default); nothing states whether a
*process rule* is in scope. Improvised REVERSIBLE + CHANGELOG line
(`AGENTS.md:40`). Same PR also carried a full goal FIT + 4 new drafts.
Tally 5/2/1/2/2.

**C5** `ci(release)` touches no contract, no parity, no persistence → one
ordinary review (`rifty-review/SKILL.md:22-24`), CHANGELOG, `pr:check`. Door
unwritten but every downstream step has a clause and the toll fits the work.
Pass. Tally 3/0/1/2/2.

**C6** Ready goal, 5 children, 3 fog lines. `goal-run.js` loops
PICKUP → Contract+RED → implement → Final+GREEN → RECHART. Per slice: PICKUP
compiles evidence artifacts, then ≥3 fresh reviewer contexts + 1 adjudicator per
checkpoint attempt, ×2 checkpoints. Map item 4 carries its prerequisite in prose
("settle Open question 1 first") and item 5 says "Blocked by build-loop" — neither
child carries `blocked_by`, which is the only field `goal-run.js:53` reads.
Fog line 1 states a collapsing answer is "a re-fit trigger", and
`backlog/README.md:123` makes re-fit = CLOSE + fresh FIT: a mid-run fact cannot
re-cut the goal in place. `decision-workflow.md:116-121` forbids the observing
session from touching tracked files. Tally 8/≥24/1/≥6/≥14.

**C7** `open-auditable-launch.md` is `status: ready` with no `tier` and no
`## Invariants`; `backlog/README.md:156` — "No tier means undecided and cannot
start a goal run". `AGENTS.md:30` sends the agent to FIT. FIT
(`FIT.md:1-45`) = bounded-destination test, probe-or-fog spikes over *every*
encoded assumption, invariants each proven false on main, a fresh critic, a fresh
report subagent — and ends before implementation (`FIT.md:8`). Then PICKUP, then
Contract+RED. 7 of 16 epics are `ready` in this state. Tally 7/≥4/0/≥3/≥6.

**C8** Ready item with `## Parity cases` + oracle probes already banked
(`npm-11-package-bin-normalization-probe.md`). PICKUP → Contract+RED → implement
→ Final+GREEN. Heavy, and the work is heavy: the toll matches. Pass.
Tally 6/≥8/1/≥3/≥6.

**C9** Every checkpoint emits `concern` (`rifty-review/SKILL.md:69,85,104`,
`blockers.mjs:130,206`). No clause names what consumes the batch —
`fault-classes.md:66` says "lands concern/backlog", unowned. `goal-run.js:45-49`
declares `VERDICT {pass, blockers}`: in an automated run every concern is
discarded at the schema boundary. #288 produced 4 (3 STRETCH at Contract+RED, 1
at Final+GREEN); they survive only in the PR body, by the author's choice.
Tally 3/0/0/0/0.

**C10** Move-only decomposition of an already-`ready` contract. Contract+RED
attempt 1 blocked (5 HOLDS), attempt 2 blocked → §Contract escalation re-refine
in place (`fault-classes.md:72`), attempt 3 pass. Contract alone
15:13→17:59 = 2 h 46 m; first RED commit → merge 6 h 26 m. ~12 ultra reviewer
runs + 4 adjudications. Produced a 259-line `reference/` artifact. Tally
6/≥16/1/≥3/≥10.

**C11** `rifty-refine` scan → grill → formalize, then `rifty-to-backlog`
challenge critic + report subagent. Worked: interview closed 7 decisions, minted
an epic-shaped draft, FIT followed. The critic returned 6 problems; 2 were fixed,
4 "stand as FIT-signoff input" — `backlog/README.md:73-76` makes the challenge
advisory and routes problems to the report, where
`rifty-to-backlog/SKILL.md:71-74` filters to only those that change the user's
decision. Nothing consumes the rest. Pass with that residue.
Tally 5/2/1/≥8/2.

**C12** Gate aborts 4× consecutive, no assertion, green standalone. `rifty-fix`
excludes it (`SKILL.md:3` — a tooling *change*, and the failure is the gate's own
resource model, not a rifty defect). No door. Filed 2026-07-15 as a
`process-meta` draft; still `draft` on 2026-08-31. The written route consumed
the finding and nothing drains it. Tally 3/0/0/1/0.

## Score

### The repo's own promises

| Promise | Clause | Fails at |
|---|---|---|
| a finding never opens a second PR | `AGENTS.md:54` | — |
| too small to review alone rides with the next delivery | `AGENTS.md:55` | C1, C2, C3 |
| decide, record, continue; never stop to ask | `AGENTS.md:38` | C6 (5 stop kinds), C7 |
| confirm-first only outward/destructive | `AGENTS.md:44` | — |
| no "implement later" / silent backlog; every gap explicit | `AGENTS.md:13` | C1 (chokepoint deferred), C9, C12 |
| a write-up is never a blocked ask | `AGENTS.md:30` | C7 (write-up *is* the hand-off's first cost) |
| delete completed work; there is no done status | `README:10-11` | — (drafts, not completions, accumulate) |
| blockers iterate in place, never a fresh start | `decision-workflow.md:96-98` | C6 (goal re-fit = close + fresh FIT) |
| knowledge never dies with the goal | `CLOSE.md:28-29` | C9 (concerns die at every checkpoint) |
| no machinery the contract is deliverable without | `AGENTS.md:23` | C2, C3 (gate machinery, not code) |

### Baseline (`PROPERTIES.md`)

| Property | fails |
|---|---|
| One door per intent | C1, C3, C4, C5, C12 |
| Confirmation only where earned | — |
| No manual relay | C6, C7, C9, C11, C12 |
| Ceremony proportional to size | C1, C2, C3, C10, C12 |
| Serialise only where it buys something | C2, C6, C10 |
| Start without a full spec | C7 |
| Emergent design is a state, not an exception | C10 (3 attempts is the norm, not a named state) |
| Re-cut in place | C6 (goal), else holds |
| Uncertainty is legible | — (fog lines, `## Open questions`, ledger all work) |
| Findings land in the unit that made them | C1, C9, C12 |
| No second queue | C3, C9, C12 |
| A lesson is paid for once | C1, C12 |

Backlog as a store (`pnpm backlog:check` @ `27442ae05`): 299 items — 275
`draft`, 24 `ready` — plus 17 epics. Growth (files under `docs/backlog`,
`reference/` excluded): 296 on 2026-07-28 → 307 on 2026-08-18 → 320 on
2026-08-31; +228 added / −142 deleted since 2026-07-01. `process-meta`: 17 in,
4 out, 13 open, oldest 2026-06-08, one drained since 2026-06-15.

## Constraint

**The process defines exactly one unit of work — a slice of a `ready` contract
inside a goal run — and sizes every ceremony for it. Work of another shape either
impersonates that unit and pays its full toll, or has no written door at all and
falls into the backlog.**

Explains: C1, C2, C3, C4, C5-door, C7, C10, C12 — and the label rot behind C6/C7
(24 `ready` items, exactly one carrying a `ready-verdict` and that one in prose,
not the mandated form; 7 of 9 `ready` epics carry no `tier`, which
`README:156` forbids from starting a run), since `ready` is asserted cheaply by
one actor and re-earned expensively by another.

Does **not** explain: the capture/drain asymmetry that keeps the 275-draft
backlog growing (capture is one skill invocation; drain is a compiled
contract plus two checkpoints — that gap survives any re-sizing of the unit), nor
C9 (concerns have no owner at any unit size). Those are a second, smaller
constraint: *the process has more producers of records than consumers.*

## Proposed changes, backfire-checked

1. **Name a second unit — the small change.** Objective test: no `ready`
   contract *and* no new or changed production behavior. Route: no backlog item,
   no checkpoint, `pr:check` scoped by `tools/checks/ci-change-scope.mjs`, rides
   in a batch PR.
   *Backfires on C4*: a process change that removes or weakens a gate would take
   the cheap route with no review. Carve it out — gate removal stays heavy.
   An earlier form keyed on the *boundary* (`fault-classes.md:61`) re-captured
   C1, the cell it was built for; keying on the contract avoids that.
   Re-rehearsed clean: C8 (has `## Parity cases` → still heavy),
   C10 (ready contract → still heavy), C6 (unchanged).
2. **Give `concern` an owner.** Add `concerns` to `goal-run.js`'s `VERDICT`
   schema and carry the batch verbatim into the PR body and the goal ledger. No
   new gate, no new turn.
   Re-rehearsed clean against C6, C8, C10 — the only cells whose trace touches
   `rifty-review/SKILL.md:69` and `goal-run.js:45`.
3. **Stop minting `process-meta` items for observed small defects; fix them on
   route 1.** *Backfires on C11*: an idea the user is not ready to act on loses
   its home. Keep capture for ideas; drop it for observed defects — which
   `rifty-fix/SKILL.md:17` already forbids deferring.

## Next run

Re-rehearse all 12. Newly-failing or newly-passing cells are the report. Add a
cell for any process lesson a real run pays for.
