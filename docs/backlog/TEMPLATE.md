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

## Challenge

<!-- Advisory premise challenge, fresh independent critic — README §Challenge. -->

challenge: <YYYY-MM-DD> — <clear | N problems, one grounded line each below>

<!-- A draft stops here. Ready rules: README + decision-workflow §Backlog readiness. -->

## User scenario

<!-- Required without `epic:`; otherwise delete. Real software, exact call, result. -->

## Acceptance

<Testable done-definition + proof path. An approximation must fail.>

## Reference contract

<!-- Keep only for an external oracle; rules: README. -->

- Oracle: <implementation + exact version>
- Mechanism: <upstream mechanism reused>

## Parity cases

<Exact reference behaviors to pin — each a failing-test-first target, run as the same scenario against oracle and rifty. Include observable identity/reflection/lifecycle/error order. Enumerate them; never "plus parity cases".>

## Fault matrix

<!-- Keep for infra. Reachable axis × operation → honest outcome + fault target.
     Shared mutable state names every writer and one serializing owner. -->

## Out of scope

<Exact inputs/APIs that throw NotImplementedError + compat ❌. Name them; never "…" / "etc.".>

## Decisions

<!-- At pickup the first line is the Contract+RED verdict, copied verbatim:
     ready-verdict: <date> — Contract+RED @ <sha>   (decision-workflow §Backlog readiness) -->

<Every fork resolved, or linked to its ADR. No open "Decide X".>
