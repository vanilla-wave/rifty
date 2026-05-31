# ADR 0064: Inflections are not stops — empirical findings and verified-need commitments don't pause for the human (extends ADR-0063)

Status: Accepted
Date: 2026-05-31
Extends: ADR-0063 (record-and-continue). Together they supersede ADR-0008's stop-on-irreversible action.

## Context

ADR-0063 told the agent to record-and-continue on irreversible decisions and to use a decision subagent when reconsidering an already-recorded one. In practice the agent still paused to ask the human at "major inflections" — a surprising spike result that changed the plan, a previously-deferred dependency whose need was now proven, or the discovery that an earlier assumption/feasibility note was stale. Treating an inflection as special re-introduces exactly the stall ADR-0063 set out to remove.

## Decision

**An inflection is not a stop trigger.** NONE of the following pause work to ask the human — the agent decides, records, re-cuts the plan, continues, and reports *after the fact*:

- a measurement / spike / test result that changes the plan or the milestone order;
- a previously-deferred decision whose gate (e.g. "no verified need") is now satisfied by evidence → ratify it;
- discovering an earlier assumption, spec, or feasibility note was stale or wrong → correct course;
- committing to a new external dependency once its need is verified.

Mechanism: a new/superseding ADR for irreversible decisions; `OPEN_QUESTIONS.md` for reversible ones; a **decision subagent** when reconsidering an already-recorded decision (ADR-0063). The human reviews recorded decisions retrospectively and can redirect at any time — they are never a synchronous gate.

## Still confirm-first (the only stops)

- Actions that are **outward-facing or destructive beyond the repo**: publishing/sending to an external service, deleting the user's data, spending money, pushing to shared remotes.
- A direction the user has **explicitly reserved** for themselves.

Everything internal to designing, deciding, and building within the repo: decide and continue.

## What does NOT change

- ADR immutability + explicit supersedence; `never modify a test to make code pass`; every irreversible decision is written down (record-and-continue ≠ decide-silently); the decision-subagent mechanism from ADR-0063.
