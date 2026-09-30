---
area: distribution
status: ready
title: Export a framework-free transcript reducer over AgentSessionEvent
created: 2026-09-27
why: every renderer re-implements the same reduction of the low-level event stream into ordered user/assistant/tool items, and the two existing copies disagree on cancelled tools and drop two event kinds
epic: no-coi-agent-host-kit
sources: [ADR-0424, ADR-0427, ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/types.ts, packages/agent/src/session.ts, apps/playground/src/ai/AiChatPanel.tsx]
---

## Context

I7 moves the live transcript projection from Playground into @riftydev/agent.
ADR-0485 selects a pure reducer over native events; actual Pi0.85.1 budget
termination can emit only its last assistant in agent_end.messages, so replacing
whole chat history from that event is wrong. Evidence in the reference file.

## User scenario

The embedding renders ordered user/assistant/tool rows, observes streaming,
command output and cancellation, then continues after budgets, model switches,
retry or compaction without losing prior rows. Playground uses the same reducer.

## Acceptance

1. Exported initializer/reducer project real native events into ordered stable-id
   user/assistant/tool items without mutating previous state; streamingText is
   separate from the final native message, including existing image content. → I7
2. Proposal/start/end/message receipts yield one tool row per current call;
   states pending/running/success/error/cancelled follow actual receipts. Results
   and command output remain visible. → I7
3. Budget/context exhaustion has a terminal entry; an abbreviated agent_end never
   erases preceding user/tool rows or invents tool settlement. → I7 + ADR-0485
4. Model changes, retries, compaction, automatic steering and changed capabilities
   remain visible, preserving conversation order and history. → I7
5. Playground consumes the exported model and visibly retains completed/skipped
   tools at budget exit, live shell output and cancelled Stop state. → I7 + scenario

## Fault matrix

| Axis × operation | Honest outcome | Proof |
| --- | --- | --- |
| lossy-aggregate × abbreviated terminal | retain prior user/tools | real budget trace + UI → I7 |
| provenance-lie × tool settlement | distinguish cancelled from error using actual result | real budget/error/Stop → I7 |
| sibling-drift × live/replayed events | shared reducer handles both | native trace replay + Playground → I7 |

## Challenge

challenge: 2026-09-30 — clear; accepted I7 premise reused. Native budget probe
kills the old full-tail replacement; pure projection avoids another state owner.

## Out of scope

- New UI component, persistence service, framework store or subscription owner.
- Cross-session transcript storage; native initialMessages remains caller-owned.

## Decisions

ready-verdict: 2026-09-30 — Contract+RED @ f87e09e7b78075da98f44d6b7d133a36a9d1d08d

- 2026-09-30 — ADR-0485: pure incremental projection; source AgentSession tools are sequential, no new output correlation mechanism.
