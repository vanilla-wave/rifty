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
     Reported to the user at FIT completion (README §Report).
     A run only proves them. Amending a ready goal = close + re-fit. -->

- I1. <user-observable statement>

## Challenge

<!-- Advisory: fresh critic attacks invariants⇒value at FIT — README §Challenge. -->

challenge: <YYYY-MM-DD> — <clear | N problems, one grounded line each below>

## Decisions

- <fit-time decisions; one line each>
- rejected route: <cheaper/rival route considered> — violates <I#|Outcome clause>
```

## `map.md` — live plan (freely edited at every re-chart)

Index, not store: one line + link per entry; content lives on items/ledger.

```md
## Items

1. `<area>/<slug>` — **<slice>** — <dependency/result>

## Open questions

<!-- Fog: in-scope questions not yet phrasable as a contract. A child whose
     contract depends on an open question is not seeded. Don't pre-slice fog.
     Owner-typed: a user-owned observable-scope question answerable now is
     ASKED at FIT, never parked here (rifty-goal FIT 3); owner: user lines
     carry why they are not answerable yet and route to rifty-refine at
     PICKUP, never to a probe. Split a mixed question by owner. -->

- <question> — owner: <user|agent> — <what settles it: probe/spike/decision;
  for owner: user — why not answerable now>

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
