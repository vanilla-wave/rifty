---
area: <area>
status: draft
title: <short label>
created: <YYYY-MM-DD>
why: <one line — why this is on the backlog>
user_story: As <persona>, I want <concrete action>, but today <concrete blocker>
epic: <epic-slug>
blocked_by: []
sources: []
code: []
---

## Context

<Situation. What's missing / wrong / deferred.>

<!-- A `draft` can stop here. To reach `ready`, fill the contract below (use the rifty-refine skill).
     `ready` ⇒ an implementer builds it whole: zero new decisions, zero new in-scope items, the ADR (if any) already exists. -->

## User scenario

<!-- Required ONLY when this item has no `epic:` (an epic child inherits the scenario from its epic — delete this section then).
     Epic-grade + concrete: the real npm package / Node program the user runs, the exact call, what they observe.
     Mission-anchored — can't name the real software it unblocks? Not user value (off-mission or process-meta debt). -->

## Acceptance

<Concrete, testable done-definition + proof command/test path. An approximation must fail it; source grep, fake, or opt-in lane cannot close it.>

## Reference contract

<!-- Required when matching an external/reference implementation; delete otherwise.
     Pin oracle + version. Name the upstream mechanism reused. Proxy/wrapper semantic copies require an ADR + differential suite. -->

- Oracle: <implementation + exact version>
- Mechanism: <upstream mechanism reused>

## Parity cases

<Exact reference behaviors to pin — each a failing-test-first target, run as the same scenario against oracle and rifty. Include observable identity/reflection/lifecycle/error order. Enumerate them; never "plus parity cases".>

## Fault matrix

<!-- Required when the item touches cache/persistence/network/concurrency; delete otherwise.
     One row per applicable axis (docs/process/fault-classes.md) × operation → honest outcome
     (fallback / degraded-but-correct / loud throw). Each row = a fault-test target.
     If the item introduces/touches SHARED MUTABLE STATE (a file, a key, a claim): enumerate
     ALL its writers and name the SINGLE owner serializing them — rows per known writer-pair
     are not enough (PR #131: the writer-set invariant was never contracted; 5 review rounds
     found the interleavings one by one). -->

## Out of scope

<Exact inputs/APIs that throw NotImplementedError + compat ❌. Name them; never "…" / "etc.".>

## Decisions

<Every fork resolved, or linked to its ADR. No open "Decide X".>
