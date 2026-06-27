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

## Acceptance

<Concrete, testable done-definition. An approximation must fail it.>

## Parity cases

<Exact Node behaviors to pin — each a failing-test-first target. Enumerate them; never "plus parity cases".>

## Out of scope

<Exact inputs/APIs that throw NotImplementedError + compat ❌. Name them; never "…" / "etc.".>

## Decisions

<Every fork resolved, or linked to its ADR. No open "Decide X".>
