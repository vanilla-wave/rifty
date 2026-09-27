# ADR 0473: Continue agent sessions with native retry and compaction

Status: Accepted
Date: 2026-09

> TL;DR: Keep Agent's history; adapt public Pi retry and compaction utilities at the request boundary.

## Context

Goal agent-weak-models I5/I6 requires Pi 0.85.1 continuation after I12's frozen
baseline. Independent DEC-2 probes compared AgentHarness with the existing
Agent plus public utilities: Harness adds entry persistence, lane/event and
model-selection adapters; its extra ownership is unnecessary here.

## Decision

1. Agent remains the sole conversation/tool-loop owner. Use native
   `retryAssistantCall`, `prepareCompaction`, `compact`, `convertToLlm` and token
   estimators. No copied classifier/summary algorithm or second history ledger.
2. Retry defaults enabled/3/2000 ms; transport retries remain zero. Failed
   partial responses never dispatch tools; one response start survives retries.
   Re-read the selected model/defaults on every request, including summaries.
   Native context overflow takes priority over transient classification.
3. Compaction defaults enabled/reserve16384/keepRecent20000. Project current
   messages temporarily to native entries; install one leading native summary
   plus details and retained tail only after successful summary generation.
   Preserve details across JSON restore and subsequent compaction. Use native
   conversion on wire. Do not reject from estimated post-summary size alone:
   the actual CLI can send such a context successfully.
4. Context overflow permits one compact-and-continue per consecutive overflow episode after removing the failed
   assistant response; successful assistant/tool responses reset recovery. No tools replay. Failed/no-cut compaction or another
   overflow ends `context-exceeded`; the user may select another entry and
   continue. Stop/deadline abort summary and backoff as well as Agent.
5. Usage counts every current-session request, including failed/discarded and
   summary attempts. Restored usage is excluded. `restoredMessageCount` counts
   originally admitted messages until reset, independent of later compaction.
6. Visible retry/compaction events carry attempts, outcome and token estimates;
   the chat retains successful compaction markers and offers explicit model
   selection/continuation for `context-exceeded`.

Corrects ADR-0424 §4's zero-agent-retry policy; partially overrides §2: raw continuation remains forbidden except after failed
overflow-response removal and successful compaction (§4 above).
ADR-0424 §6 action replay prohibition and ADR-0376/0377 host recovery remain.
Corrects ADR-0466's admitted envelope list and restored-prefix interpretation.

## Consequences

- Native public utilities own policy; Rifty owns lifecycle and observable events.
- Public options add partial native retry/compaction settings; trace records effective settings.
- Native file-operation extraction retains its names; Rifty tool names are not relabelled.
- Contract tests and actual CLI differential probes protect adapter seams.

## Corrections

2026-09-27 — ADR-0474 projects persisted compaction input from existing audit
receipts, including discarded assistant attempts. Agent remains the sole execution-context owner.
