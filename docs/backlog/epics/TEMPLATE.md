# Epic template — directory format (goal/map/ledger)

An epic is a directory `docs/backlog/epics/<slug>/` with three files split by
owner × mutability. Procedure: `rifty-goal` skill (FIT mode). No new
single-file epics.

## `goal.md` — destination (frozen once `status: ready`)

```md
---
kind: epic
status: draft
title: <short label>
created: <YYYY-MM-DD>
value: <one line — the user outcome this epic delivers>
user_story: As <persona>, I want <end-to-end outcome>, but today <blocker>
tier: <works|robust|production — required at ready>
---

## Outcome

<User value and faithful-runtime payoff.>

## User scenario

<Concrete end-to-end steps whose success closes the epic.>

## Invariants

<!-- Drafted at FIT from Outcome/User scenario/Decisions — never new scope.
     Each checked false on current main (evidence comment above the list).
     Signed off by the user together with tier: `signoff:` in ## Decisions.
     A run only proves them. Amending a ready goal = close + re-fit. -->

- I1. <user-observable statement>

## Decisions

- signoff: <YYYY-MM-DD> — user (invariants + tier)
```

## `map.md` — live plan (freely edited at every re-chart)

Index, not store: one line + link per entry; content lives on items/ledger.

```md
## Items

1. `<area>/<slug>` — **<slice>** — <dependency/result>

## Open questions

<!-- Fog: in-scope questions not yet phrasable as a contract. A child whose
     contract depends on an open question is not seeded. Don't pre-slice fog. -->

- <question> — <what would settle it: probe/spike/decision>

## Out of scope

- <consciously ruled beyond the destination — never graduates>
```

## `ledger.md` — append-only journal

Budget bands (declared JIT at pickup, review-owned — `rifty-review` axis 5),
one-line decisions (what + where the full answer lives), verdicts,
observations/diagnoses (or links to `reference/`). Lines are never edited or
removed; the closure walk (`rifty-goal` CLOSE) exports every line to a durable
carrier or drops it explicitly.

```md
- <YYYY-MM-DD> — <slice> band <lo>–<hi> declared at pickup
- <YYYY-MM-DD> — decided <one line>; full answer: <link>
- <YYYY-MM-DD> — ready-verdict <slice>: Contract+RED @ <sha>
```
