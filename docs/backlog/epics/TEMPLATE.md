---
kind: epic
status: draft
title: <short label>
created: <YYYY-MM-DD>
value: <one line — the user outcome this epic delivers>
user_story: As <persona>, I want <end-to-end outcome>, but today <blocker>
tier: <works|robust|production — required for an autonomous goal>
# goal_baseline: <ready-epic SHA; add alone, land before any source PR>
---

## Outcome

<User value and faithful-runtime payoff.>

## User scenario

<Concrete end-to-end steps whose success closes the epic.>

## Invariants

<!-- Frozen with the marker. Numbered observable statements the closing smoke proves.
     Authored only at user-tier refine; the run proves them, never writes or edits them. -->

- I1. <user-observable statement>

## Items

<!-- Historical slice/role ledger; child `epic:` links are the live residual set. -->

1. `<area>/<slug>` — **<slice>** — <dependency/result>

## Budget

<!-- Required for autonomous pickup. Append JIT rows; never weaken existing data. -->

- scope implemented outside `ready` items: 0
- in-place ready-contract edits alongside source changes: 0
- new coordination mechanisms: 0
- review checkpoints per slice: exactly 2

| slice | band |
|---|---|
| <slice> | <lo>–<hi> |
