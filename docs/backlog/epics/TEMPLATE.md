---
kind: epic
status: draft
title: <short label>
created: <YYYY-MM-DD>
value: <one line — the user outcome this epic delivers>
user_story: As <persona>, I want <end-to-end outcome>, but today <blocker>
tier: <works|robust|production — required for an autonomous goal>
# goal_baseline: <ready-epic SHA; add alone, in a commit before the branch's first source commit>
---

## Outcome

<User value and faithful-runtime payoff.>

## User scenario

<Concrete end-to-end steps whose success closes the epic.>

## Invariants

<!-- Frozen with the marker (shape: README §Shape). Authored with the user — refine
     interview or direct sign-off; the run proves them, never writes or edits them.
     Each must be false on main before the run: a trivially-true invariant closes
     the goal on an empty proof. -->

- I1. <user-observable statement>

## Items

<!-- Historical slice/role ledger; child `epic:` links are the live residual set. -->

1. `<area>/<slug>` — **<slice>** — <dependency/result>

## Budget

<!-- Required for autonomous pickup. Append JIT rows; never weaken existing data. -->

- scope implemented outside `ready` items: 0
- ready-contract edits after pickup: 0
- new coordination mechanisms: 0

| slice | band |
|---|---|
| <slice> | <lo>–<hi> |
