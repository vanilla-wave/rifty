# Process — map

The user owns the destination; the agent owns the route. Fidelity is unchanged:
real reference behavior, RED before a product repair, no fake implementation,
independent review. Rules have one home; other documents link to it.

## Layers

| Layer | Artifact | Owner |
|---|---|---|
| Destination | `goal.md`: outcome, scenario, invariants, tier | user; explicit amendments in place (`RDY-6`) |
| Route | `map.md`, unit contracts, ordering, mechanisms | agent (`RDY-5`) |
| Evidence and history | review JSON, tests, `ledger.md`, git | producer; prior observations stay history |

An obligation comes from the accepted scenario, an invariant, an ADR, or the
existing baseline. A reviewer's suggestion becomes work only if that authority
requires it. The source of a discovery does not decide its route (`REV-12`).

## Stages

Every authorized change follows one route. The evidence already available
decides which preparation remains; a document or a skill name does not.

| Stage | Procedure | Result |
|---|---|---|
| FIT, goals only | `stages/fit.md` | accepted destination and initial map |
| PICKUP | `stages/pickup.md` | authority and missing proof identified |
| Contract+RED, when needed | `stages/contract-red.md` | independent promise/RED proof before new behavior |
| IMPLEMENT | `stages/implement.md` | honest implementation, GREEN |
| Final+GREEN | `stages/final-green.md` | independent review of the delivered result |
| RECHART, goals only | `stages/rechart.md` | obligations/map reflect the result |
| CLOSE | `stages/close.md` | accepted obligations proven, residuals resolved |

An observed defect already has a baseline: reproduce, RED, fix, Final+GREEN.
A new parity/stateful promise needs Contract+RED first. Proof about existing
behavior uses that behavior as its authority. Documentation has no product RED.
All use the same review procedure and verdict (`stages/checkpoint-run.md`).

An explicit whole-goal hand-off loops the route over the map, then CLOSE.
A standalone request finishes its unit. The starting session drives the entire
route, including routine records and its report; never return control between
stages. `.claude/workflows/goal-run.js` is a single-driver entry, not a stage
orchestration engine. Fresh contexts are for independent decisions (`DEC-5`).

## Entry points

Intent selects the entry: unsettled user input → `rifty-refine`; observed
failure → `rifty-fix`; authorized item/change → PICKUP; whole goal →
`rifty-goal`. `rifty-to-backlog` records work that must wait. Capturing a fact
never requires another hand-off for work already authorized in this session.

## Stops

`STOP-1`: a choice only the user can make. A technical failure stays agent-owned.
Continue independent work; an unresolved dependency stays visible. No progress
means change the approach, then report the technical limit if none remains —
never ask the user to authorize another attempt (`rules/stops.md`).

## Rules and artifacts

| ids | home |
|---|---|
| DEC | `rules/decisions.md` |
| RDY | `rules/readiness.md` |
| REV | `rules/review.md` |
| STOP | `rules/stops.md` |
| PR | `rules/pr.md` |

Shapes: `artifacts/goal.md`, `map.md`, `ledger.md`, `unit.md`, `verdict.md`.
Fault models: `rules/fault-classes.md`; test pyramid: `rules/testing.md`;
lessons: `traps.md`; backlog storage: `docs/backlog/README.md`.

## Machine gates

- `backlog:check`: schema, links, ready sections, trace, premise check at pickup.
- `check:contract-drift`: changes to accepted scope carry their decision record.
- `tools/review/blockers.mjs`: the one verdict validator; coverage and authority.
- `check:pass-binding`: the same validator plus the reviewed version at merge.
- `refs:check`: durable documentation links.

Machines validate records, never infer human authorization or prove reference
semantics from a filename. Independent review verifies both. PR packaging is
agent-owned (`PR-3..4`). Historical rule ids remain readable in git history.
