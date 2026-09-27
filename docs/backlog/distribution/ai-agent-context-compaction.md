---
area: distribution
status: draft
title: Compact the retained history before the next model request as pi 0.85.1 does, visibly and with full usage totals, and end a run that cannot fit with a distinct context-exceeded status
created: 2026-09-27
why: On a small-window endpoint the agent dies on context overflow — the user named compaction a survival mechanism, and pi's compaction already exists in pi-agent-core.
user_story: As a developer running the agent on a 32k–128k endpoint, I want long tasks to survive by summarizing older history like the pi CLI does, but today the retained history grows until the provider rejects the request and the run ends with `error`.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-weak-model-baseline-lane]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md]
code: [packages/agent/src/session.ts, packages/agent/src/types.ts, apps/playground/src/ai/AiChatPanel.tsx]
---

## Context

finding — goal slice 7 (I5); after slice 4 (baseline first); adds the `compaction` option (default on) over the entry's `contextWindow` (per entry,
`compaction` option).

- Ours: no compaction; `AgentStatus` (`types.ts:141`) has no
  `context-exceeded`; a provider context-length error ends the run at once
  with `error` (`session.ts:269-271`); `exportTrace` sums usage from the
  retained assistant messages only (`session.ts:335-341`).
- Reference: pi 0.85.1 — `pi-agent-core` `shouldCompact(contextTokens,
  contextWindow, settings)`, `prepareCompaction(entries, settings)`,
  `compactWithRequest(preparation, options, request, context)`,
  `estimateTokens`, `DEFAULT_COMPACTION_SETTINGS`
  (`harness/compaction/compaction.d.ts:59-125`); CLI defaults reserve 16384 /
  keep recent 20000; trigger `contextTokens > contextWindow − reserveTokens`
  checked after tool results, before the next assistant response; compaction
  happens inside the run and resumes with summary + retained tail (upstream
  pi doc `compaction.md`, packages/coding-agent/docs).
- After this slice: the summary is generated through the selected entry's
  transport; the summary stays in history; a compaction event with tokens
  before/after is emitted, rendered as a marker in the playground chat (this
  slice owns that UI half and the chat's `context-exceeded` switch offer, I4 —
  both extend the kit's reducer `distribution/agent-transcript-model`, PR
  #357, which lands first: user 2026-09-27 «6 - ок») and kept in the exported
  trace; trace usage totals keep the compacted-away
  messages and add the summary requests (critic finding 10); a request that
  cannot fit after compaction — e.g. a window smaller than reserve + retained
  tail — ends the run with `context-exceeded`, distinct from `budget-exceeded`
  and `error`; `compaction: { enabled: false }` disables.
- Carrier fog (goal map): `AgentHarness` adoption vs low-level `Agent` +
  `transformContext` with an `AgentMessage[]`→`Entry[]` adapter; the choice
  must keep ADR-0424 §2 (pi owns history) and the per-entry transport.
- Parity cases at PICKUP: the same scripted conversation against the pi CLI
  0.85.1 with a small `contextWindow` in `models.json` — trigger turn,
  summary placement, retained tail and resumed run must match.
- Fault matrix expected at PICKUP (`AGENTS.md` §DoD): summary request fails
  (provider error) → as pi 0.85.1 does for threshold compaction
  (`agent-session.js:1867-1889` reports the error and returns `false`; the
  hook `:274-286` continues the next request with the unchanged history) — the
  error is an event, history untouched, no loop beyond the retry slice's
  policy; if that next request then overflows, `context-exceeded`; compaction during
  `stop()` → settles aborted, no partial summary retained; proxy omits `usage`
  → token estimate from `estimateTokens`, noted in the event; window smaller
  than reserve + retained tail → `context-exceeded`.
- Out of this slice: rule-based pruning stage (goal map fog), branch
  summarization / session tree (pi CLI features outside ADR-0424).

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (defaults, compaction reference, tier).
