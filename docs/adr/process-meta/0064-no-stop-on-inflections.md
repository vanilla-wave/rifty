# ADR 0064: Inflections are not stops — empirical findings and verified-need commitments don't pause for the human (extends ADR-0063)

Status: Accepted
Date: 2026-05-31
Extends: ADR-0063 (record-and-continue). Together they supersede ADR-0008's stop-on-irreversible action.

## Context

ADR-0063 said: record-and-continue on irreversible decisions, use a decision subagent to reconsider an already-recorded one. Yet the agent still paused at "major inflections" — a surprising spike result, a deferred dependency whose need was now proven, or a stale earlier assumption. Treating an inflection as special re-introduces the stall ADR-0063 removed.

## Decision

**An inflection is not a stop trigger.** None of these pause work; the agent decides, records, re-cuts the plan, continues, and reports *after*:

- a measurement / spike / test result that changes the plan or milestone order;
- a deferred decision whose gate (e.g. "no verified need") is now satisfied by evidence → ratify it;
- an earlier assumption, spec, or feasibility note found stale or wrong → correct course;
- committing to a new external dependency once its need is verified.

Mechanism: new/superseding ADR for irreversible decisions; `OPEN_QUESTIONS.md` for reversible ones; a **decision subagent** when reconsidering an already-recorded decision (ADR-0063). The human reviews recorded decisions retrospectively and can redirect anytime — never a synchronous gate.

## Still confirm-first (the only stops)

- Actions **outward-facing or destructive beyond the repo**: publishing/sending to an external service, deleting the user's data, spending money, pushing to shared remotes.
- A direction the user has **explicitly reserved**.

Everything internal to designing, deciding, and building in the repo: decide and continue.

## What does NOT change

ADR immutability + explicit supersedence; `never modify a test to make code pass`; every irreversible decision is written down (record-and-continue ≠ decide-silently); the decision-subagent mechanism from ADR-0063.
