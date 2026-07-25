---
kind: epic
status: draft
title: <short label>
created: <YYYY-MM-DD>
value: <one line — the user outcome this epic delivers>
user_story: As <persona>, I want <end-to-end outcome>, but today <blocker>
items: []
---

## Outcome

<The user value, from the user's POV — and how it grows the rifty ecosystem (real Node software in the browser; anchor to the mission). If it has no faithful-runtime payoff, it is not an epic.>

## User scenario

<The end-to-end scenario that, when it works, means this epic is done. Concrete steps a user takes (e.g. clone → npm i → npm run dev → preview opens).>

## Invariants

<!-- FROZEN (with Outcome / User scenario / tier / Out of scope / Budget): immutable for the whole run;
     editing = user-tier re-refine event named in the PR — a silent diff is a review blocker.
     Numbered, checkable statements of observable behavior, in TEXT (tests derive from them, never replace them).
     Each child item names the invariant(s) it serves via `invariants:` frontmatter. -->

- I1. <user-observable statement the closing smoke proves>

## Items

<Living plan, not contract: each child item (`<area>/<slug>`), its role, and the invariant(s) it serves. The agent may mint/merge/re-cut mid-run via capture + judge; serial order goes here only if it is NOT user-value-bearing (else it belongs in the envelope).>
