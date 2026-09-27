---
area: distribution
status: ready
title: Continue catalog sessions through native Pi retry and compaction without replaying tools
created: 2026-09-27
why: Small-window and flaky endpoints need the same continuation policy as Pi 0.85.1.
user_story: As a developer using a small or rate-limited catalog entry, I want the session to preserve completed work, retry transient responses and compact older context, with visible progress and an honest terminal outcome.
epic: agent-weak-models
sources: [docs/backlog/epics/agent-weak-models/goal.md, docs/adr/distribution/0424-headless-pi-agent-over-public-project-hosts.md]
code: [packages/agent/src/session.ts, packages/agent/src/history.ts, packages/agent/src/types.ts, apps/playground/src/ai/AiChatPanel.tsx]
---

## Context

Goal I5/I6 and remaining I4. I12 baseline must be recorded before implementation.
Native low-level Agent remains the history/loop owner. Public Pi 0.85.1 retry,
compaction preparation/generation and converter supply behavior; no copied
provider classifier, summary algorithm or second message ledger.

## Acceptance

1. Retry defaults enabled/maxRetries3/baseDelayMs2000; native exponential
   scheduling, classifier and partial-response discard. Retry-After ignored;
   transport maxRetries0. Option enabled:false disables. Trace records effective
   settings and visible retry attempts; chat discards failed partial text. → I6
2. A request after completed tool work retries only its assistant response;
   every dispatched tool has one effect, prior results remain. Selection changed
   during backoff applies at the next request with that entry's defaults. → I2, I6, ADR-0424
3. Compaction defaults enabled/reserve16384/keepRecent20000, optional native
   settings; threshold check before the next request and on resumed history.
   Selected catalog transport generates summary; history becomes native summary
   and retained tail. enabled:false disables. → I5
4. Summary survives later requests, model switch, another compaction and JSON
   export/initialMessages restore; native file-operation details survive too.
   One leading summary is admitted before host work; malformed restores reject.
   Restored-message count names originally admitted messages, not a prefix after
   compaction. → I1, I2, I5, ADR-0466
5. Trace usage totals include all current-session assistant/summary attempts,
   including compacted-away and failed attempts; restored usage excluded and
   reset clears current totals. → I5, ADR-0466
6. Compaction event carries reason, success/failure/abort and tokens before/after;
   successful summary has a persistent visible chat marker. Estimates use native
   rules when provider usage absent. → I4, I5
7. Successful assistant/tool responses reset overflow recovery. Native context overflow is separate from transient retry. At most one
   compact-and-retry per consecutive overflow episode; unrecovered overflow ends
   context-exceeded. Completed tools are never replayed. The UI offers another
   entry and explicit continue with retained history. → I4, I5, I6
8. Stop/deadline settles retries and summary work, installs no partial summary;
   existing aborted/budget-exceeded status and completed tool effects remain
   honest. → I5, I6, ADR-0424

## Parity cases

1. Actual Pi CLI and Rifty: 429×2 then success, 429×4, partial text then
   connection failure, failure after an executed tool; counts, delays, retained
   history and tool effects match. → I6
2. Actual Pi CLI and Rifty with the same conversation/small catalog window:
   threshold before next response, summary placement, retained tail, continuation;
   public native preparation/generation additionally probes repeated compaction.
   → I5
3. Retry/compaction disabled: one failed request / unchanged growing history,
   respectively. Native overflow still has the distinct Rifty terminal status.
   → I5, I6

## Fault matrix

| Boundary / axis | Injection | Observable result | Authority |
|---|---|---|---|
| Model network / unbounded-read | 429 + Retry-After; 5xx or partial-stream loss | Native bounded retries/delays, no transport retries or tool replay | → I6 |
| Model network / torn-state | Threshold summary fails | History unchanged, failure event; next response allowed; ensuing overflow gets one separate recovery attempt; failure terminates context-exceeded | → I5 |
| Model network / torn-state | Stop or deadline while summary/backoff pending | Aborted/budget terminal; no partial summary or later attempt/effect | → I5, I6, ADR-0424 |
| Native projection / provenance-lie | Provider omits usage, retained old usage after compaction | Native estimate marked; full recorded request usage never reconstructed from retained history | → I5 |
| Model network / unbounded-read | Context still overflows after summary, or no native cut point | One recovery maximum, context-exceeded, explicit model-switch offer | → I4, I5 |
| Restore / corrupt-input | Malformed summary/details or orphan tool result | Rejected before host/model work; valid own export round-trips | → I5, ADR-0466 |

## Challenge

challenge: 2026-09-27 — inherited accepted goal; independent DEC-2 native
probes resolve Agent versus Harness and restorable summary carrier.

## Decisions

ready-verdict: 2026-09-27 — Contract+RED @ 7321e33e8 — `reference/ai-agent-context-compaction-contract-red.json`

- re-cut: 2026-09-27 — absorb former transient-request-retry draft into one continuation boundary with compaction and remaining chat markers; all I4/I5/I6 obligations retained — trace: none
- Native oracle may emit a larger estimated token count after compaction; no invented fit test on estimate+reserve. Actual overflow governs bounded recovery.
- ADR-0424 §4 and ADR-0466 envelopes/count semantics require dated corrections via the continuation ADR; no changes to action replay prohibition or host recovery.

## Out of scope

Tool feedback/recipe (I7–I11), benchmark rerun (I13), action replay, automatic
model fallback, copied Pi algorithms and alternate history ownership.
