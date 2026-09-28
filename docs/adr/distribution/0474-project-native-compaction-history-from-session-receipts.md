# ADR 0474: Project native compaction history from session receipts

Status: Accepted
Date: 2026-09

> TL;DR: Project Pi's compaction input from existing audit receipts; Agent still owns execution context.

## Context

ADR-0473's current-state projection loses discarded assistant responses. Pi CLI
0.85.1 persists them before removing them from Agent.state; subsequent compaction
uses that journal. Executed differential RED: two overflow episodes differed in
summary input and tokensBefore (core14 versus CLI24).

## Decision

- Reconstruct locally from admitted initialMessages and existing message_end events.
  Assistant retry-start additionally records the discarded response; summary retries
  never enter conversation history.
- Successful compaction records native summary/details/timestamp and retained-message
  count. Projection becomes summary plus that suffix; zero count means empty suffix.
  Failed compaction leaves the projection unchanged. Reset clears receipts and seed.
- No persistent second message array/cache, tool dispatch owner or copied algorithm.
  Agent owns request context; public native utilities own cutting and summarization.
- Core preparation filters failures for its tokensBefore estimate; CLI does not.
  Supply public `estimateContextTokens(rawProjection)` as preparation.tokensBefore.
- Preserve observed native terminal failures; never silently delete more messages
  than the native continuation does.

## Consequences

Independent DEC-2 probes matched actual CLI SessionManager context and preparation
through two compactions, also after transient429. Current-state-only is disproven;
Harness migration requires unnecessary history/event/model adapters. Differential
suite checks retained context, summary requests, counts, events and tool effects.

Scope: clarification of ADR-0473's ephemeral projection, not a second conversation owner.
