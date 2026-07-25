---
kind: epic
status: draft
title: <short label>
created: <YYYY-MM-DD>
value: <one line — the user outcome this epic delivers>
user_story: As <persona>, I want <end-to-end outcome>, but today <blocker>
items: []
tier: <works|robust|production — required for an autonomous goal>
# goal_baseline: <ready-epic SHA; add alone, land before any source PR>
---

## Outcome

<The user value, from the user's POV — and how it grows the rifty ecosystem (real Node software in the browser; anchor to the mission). If it has no faithful-runtime payoff, it is not an epic.>

## User scenario

<The end-to-end scenario that, when it works, means this epic is done. Concrete steps a user takes (e.g. clone → npm i → npm run dev → preview opens).>

## Items

<Known child residuals (`<area>/<slug>`) and dependency order. Seed, not exhaustive plan; reverse-linked children are authoritative.>

## Budget

<!-- Required before autonomous pickup. Add one just-in-time slice before its Contract+RED; never weaken existing rows/tripwires. -->

- scope implemented outside `ready` items: 0
- in-place ready-contract edits alongside source changes: 0
- new coordination mechanisms: 0
- review rounds per slice: ≤ 2

| slice | band |
|---|---|
| <slice> | <lo>–<hi> |
