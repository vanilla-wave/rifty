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

<!-- A draft stops here. Ready rules: README + docs/process/rules/readiness.md (RDY-2..4). -->

## User scenario

<!-- Required without `epic:`; otherwise delete. Real software, exact call, result. -->

## Acceptance

<!-- Each row ends with its trace: → I3 | → scenario | → ADR-NNNN (RDY-3).
     Untraced and rule-id-only (→ REV-7) rows are notes, never obligations. One intent per unit (RDY-4). -->

1. <Testable done-definition + proof path; an approximation must fail> → I#

## Reference contract

<!-- Keep only for an external oracle; rules: README. -->

- Oracle: <implementation + exact version>
- Mechanism: <upstream mechanism reused>

## Parity cases

1. <Exact reference behavior — a failing-test-first target, same scenario against oracle and rifty; include observable identity/reflection/lifecycle/error order. Artifact: command + output + version. Never "plus parity cases"> → I#

## Fault matrix

<!-- Keep for infra. Reachable axis × operation → honest outcome + fault target → trace.
     Shared mutable state names every writer and one serializing owner. -->

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|

## Out of scope

<Exact inputs/APIs that throw NotImplementedError + compat ❌. Name them; never "…" / "etc.".>

## Decisions

<!-- One-line records only (docs/process/artifacts/unit.md). At pickup the first
     line is the Contract+RED verdict, copied verbatim:
     ready-verdict: <date> — Contract+RED @ <sha>
     review: checkpoints | ordinary                       (RDY-8)
     re-cut: <date> — <what> — trace: none               (RDY-5)
     Evidence blocks go to reference/<slug>-evidence.md, never here (RDY-4). -->

<Every fork resolved, or linked to its ADR. No open "Decide X".>
