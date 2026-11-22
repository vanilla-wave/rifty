# Epic template — directory format (goal/map)

An epic is a directory `docs/backlog/epics/<slug>/` with two files split by
owner: `goal.md` (user) and `map.md` (agent). Procedure: `docs/backlog/README.md`
§Epic fit. No new single-file epics.

## `goal.md` — user-owned destination

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

<!-- Drafted at FIT — in the refine session for a refined epic (rifty-refine §4) —
     from Outcome/User scenario/Decisions — never new scope.
     Each checked false on current main (evidence comment above the list).
     Reported to the user at FIT completion (README §Report).
     A run only proves them; every child row traces to one.
     Amend a ready goal with the user's recorded decision (README §Scope authority). -->

- I1. <user-observable statement>

## Challenge

<!-- Premise critique at refine/FIT; reuse unchanged evidence — README §Challenge. -->

challenge: <YYYY-MM-DD> — <clear | N problems, one grounded line each below>

## Decisions

- <fit-time decisions; one line each>
- rejected route: <cheaper/rival route considered> — violates <I#|Outcome clause>
```

## `map.md` — live plan (agent-owned, freely edited)

Index, not store: one line + link per entry; content lives on items.

```md
## Items

1. `<area>/<slug>` — **<slice>** — <dependency/result>

## Open questions

<!-- Fog: in-scope questions not yet phrasable as a contract. A child whose
     contract depends on an open question is not seeded. Don't pre-slice fog.
     A user-owned question is ASKED at FIT (README §FIT 3); unanswered →
     the goal stays draft, the question recorded here as owner: user. A ready
     map is agent-owned; owner: user otherwise only mid-run (a goal conflict —
     AGENTS.md §Fidelity). Split a mixed question by owner. -->

- <question> — owner: agent — <what settles it: probe/spike/design>

## Out of scope

- <consciously ruled beyond the destination — never graduates>
```
