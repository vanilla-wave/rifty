---
area: distribution
status: draft
title: Export a framework-free transcript reducer over AgentSessionEvent and render the playground chat from it
created: 2026-09-27
why: every renderer re-implements the same reduction of the low-level event stream into ordered user/assistant/tool items, and the two existing copies disagree on cancelled tools and drop two event kinds
epic: no-coi-agent-host-kit
sources: [ADR-0424, ADR-0427, ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/types.ts, packages/agent/src/session.ts, apps/playground/src/ai/AiChatPanel.tsx]
---

## Context

Finding. `AgentSessionEvent` (`packages/agent/src/types.ts:100-114`) has four
kinds: `agent` (Pi passthrough), `status`, `capabilities`, `output`. The only
in-repo reduction is inside a Solid component
(`apps/playground/src/ai/AiChatPanel.tsx:17-253`, ≈220 lines): it models
`message`/`tool` items, streams text into the assistant item, dedups tools by
`toolCallId`, re-reduces the tail on `agent_end`, but collapses cancelled tool
results into `isError` and never handles `capabilities` or `output`. Issue
#345's host wrote the same reduction again (≈90 lines). `exportTrace()`
already returns the settled transcript (`AgentTrace.transcript`) but not the
live streaming state a renderer needs.

Goal obligation: I7 — ordered user / assistant / tool items, streaming text
apart from the finished message, tool state running → success | error |
cancelled, dedup by `toolCallId`, terminal budget-exceeded entry; the
playground chat renders from the exported reducer (dogfood; D-002 keeps the
reducer framework-free).

## Out of scope

- Rendering, styling or a UI component (`distribution/ai-ide-product-ui`).
- Chat persistence / restore (ADR-0436 §Alternatives, deferred).

## Decisions

- shape `reduce(state, event) → state` (pure) is the minimal carrier; an
  observable/store wrapper is host code.
