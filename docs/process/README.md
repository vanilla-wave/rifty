# Process — map

One frozen layer; everything else is path. Rules carry ids (`DEC-n`, `RDY-n`,
`REV-n`, `STOP-n`, `PR-n`); a reviewer, a gate, or a stop cites the id. Each
rule has exactly one home; other files link, never restate.

## Layers

| Layer | Artifact | Owner | Changes |
|---|---|---|---|
| Destination (frozen) | `goal.md`: Outcome, User scenario, Invariants `I#`, tier, rejected routes | user | never inside a run; amend = CLOSE + FIT |
| Path (live) | `map.md`, unit contracts, mechanisms, splits | agent | any time, one ledger line each (`RDY-5`); membership fixed at pickup (`RDY-8`) |
| Journal (append-only) | `ledger.md`; `## Decisions` one-liners in the unit | agent writes | ledger grows only; the pass history is git log (`REV-8`) |

An obligation is a contract row traced to the destination (`→ I3`), the user
scenario, or an ADR (`RDY-3`). Untraced and rule-id-only rows are notes: no
coverage row, no blocker (`REV-2`). Size: one intent, one session (`RDY-4`).

## Roles

| Role | Session | Edits | Never |
|---|---|---|---|
| user | interactive | `goal.md` via FIT/refine; stop resolutions | — |
| driver (orchestrator + worker + runner) | the hand-off session; one fresh session per stage only where a harness driver exists (`goal-run.js`) | path + journal, reception lines (`REV-12`) | its own checkpoint verdict; narrating a wait (`DEC-5`) |
| reviewer | fresh, read-only per checkpoint | `verdict.json` | tracked files |
| critic / adjudicator | fresh, read-only | `challenge:` line, `adjudication.json` | fix; mint a unit from a finding |

Fresh context only where it is the evidence: reviewer, critic (`REV-11`). A
decision leaves a session only through the journal (`DEC-5`).

## Stages

| Stage | Doc | Input → output | Gate |
|---|---|---|---|
| FIT | `stages/fit.md` | outcome → ready goal dir | `backlog:check`; report |
| PICKUP | `stages/pickup.md` | draft unit → ready unit + membership | `RDY-2..4`, `RDY-8` |
| Contract+RED | `stages/contract-red.md` | contract + RED → `ready-verdict:` | `REV-5`, `STOP-3` |
| IMPLEMENT | `stages/implement.md` | RED → GREEN, `pr:check` | contract |
| Final+GREEN | `stages/final-green.md` | slice tree → PASS recorded where it lands | `REV`, `STOP-3..4` |
| RECHART | `stages/rechart.md` | landed slice → map + ledger | `re-chart after` line |
| CLOSE | `stages/close.md` | empty map → deleted goal dir | invariants proof |

Checkpoint mechanics (runner, passes, reception, lineage):
`stages/checkpoint-run.md`. A unit with a doc runs PICKUP → Contract+RED →
IMPLEMENT → Final+GREEN on its own — inside a goal or standalone; a unit
with no doc (an observed-defect fix, a docs change — `RDY-8`) runs
IMPLEMENT → ordinary review → merge; a goal loops the doc'd path over its map (PICKUP
takes the frontier child, RECHART lands the slice) until the map is empty,
then CLOSE. A goal run starts on an explicit whole-ready-goal hand-off.
Claude sessions may drive it via `.claude/workflows/goal-run.js` — the script
owns order and bookkeeping only, its prompts point here; any other session
drives the loop itself (`rifty-goal`) and never ends a turn between stages.
Entry points: `rifty-refine` (user input), `rifty-to-backlog` (agent intake),
`rifty-fix` (observed defect), the pickup ask for a standalone item
(`stages/pickup.md`; the session drives the stages itself), and the change
itself for a no-doc unit (`rules/pr.md` `PR-2`).

## Stops

Closed list (`rules/stops.md` `STOP-1`): observable-scope fork · premise
concern · destination conflict — all three about WHAT gets built. Nothing
else asks: a stall re-cuts once, then the unit leaves the path as a fog line
owned like its trace (`STOP-4`) — inside a goal a fork leaves the path the same way
and the run continues, the question asked when it blocks; a premise or
destination stop halts the run. A stop names what the user decides that the
agent cannot; "continue?" is a status.

## Rules

| ids | home | subject |
|---|---|---|
| `DEC` | `rules/decisions.md` | reversibility, reconsidering, confirm-first, subagents, session hygiene |
| `RDY` | `rules/readiness.md` | draft → ready, trace, intent, re-cut ownership, membership |
| `REV` | `rules/review.md` | scope, authority, severity, coverage, evidence bar, lineage, rubric, reception |
| `STOP` | `rules/stops.md` | closed stop list, stall, re-cut, report |
| `PR` | `rules/pr.md` | unit of delivery, draft PR, referees |
| — | `rules/fault-classes.md` | fault taxonomy, boundary failure models, class-kill, seam |
| — | `rules/testing.md` | test pyramid, why parity |
| — | `traps.md` | hard-won gotchas |

## Artifacts

`artifacts/goal.md` · `artifacts/map.md` · `artifacts/ledger.md` ·
`artifacts/unit.md` · `artifacts/verdict.md` — shape, owner/editors per
section, line forms. Store rules (areas, statuses, challenge, tier, gates):
`docs/backlog/README.md`.

## Machine gates

| Gate | Enforces |
|---|---|
| `backlog:check` | schema, ready sections, links, markers, goal-dir shape, challenge; trace on ready items `created ≥ 2026-09-03` (`RDY-3`) |
| `check:contract-drift` | frozen goal fields beside source (single-file and `epics/<slug>/goal.md`); a ready contract (status + graded sections) changed beside source carries `re-cut:` (`RDY-5`); a ready flip beside source carries `ready-verdict:` or `review: ordinary` (`RDY-8`); referees land separately (`PR-4`) |
| `tools/review/blockers.mjs` | verdict shape, authority on blockers, trace on coverage rows, exit codes (`artifacts/verdict.md`) |
| `refs:check` | dangling doc/ADR references cited from `docs/adr` and `docs/backlog` |

Machine gates prove only the listed facts; review owns everything else.
`docs/process/decision-workflow.md` and `docs/process/fault-classes.md` are
stubs kept for immutable ADR citations.
