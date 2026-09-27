---
area: distribution
status: draft
title: Retry a retryable assistant error with pi 0.85.1's agent-level policy, every attempt visible, never re-sending a response whose tool calls were dispatched
created: 2026-09-27
why: Cheap endpoints rate-limit and fail transiently (11 of 12 calls 429 on one provider); today one failed request ends the run with error while the pi CLI retries 3× by default.
user_story: As a developer running the agent against a rate-limited endpoint, I want a 429 or connection reset to be retried with backoff like pi does, but today `streamSimple` is called once and the run ends with `error`.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-weak-model-baseline-lane]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, docs/adr/distribution/0424-headless-pi-agent-over-public-project-hosts.md]
code: [packages/agent/src/session.ts]
---

## Context

finding — goal slice 6 (I6); after slice 4 (baseline first); adds the `retry` option (default on) over the selected entry's
transport).

- Ours: `session.ts:131` calls `streamSimple` with no retry; ADR-0424 §4
  "zero automatic retries" (transport) and §6 "the agent never retries an
  action automatically". No `retry` in `packages/agent/src`.
- Reference: pi CLI defaults `retry.enabled true`, `retry.maxRetries 3`,
  `retry.baseDelayMs 2000`, `retry.provider.maxRetries 0` (upstream pi doc
  `settings.md` lines 143-148); CLI implementation
  `pi-coding-agent/dist/core/agent-session.js`: `_isRetryableError(message)`
  → pi-ai `isRetryableAssistantError` (:2248-2252); `_prepareRetry`: gives up
  when `_retryAttempt > settings.maxRetries` (3 retries after the original),
  delay `baseDelayMs * 2 ** (attempt − 1)` (:2286-2301), `auto_retry_*`
  events; a retryable error after partial text is retried too (critic probe,
  evidence §Critic 3). `pi-agent-core` `AgentHarnessOptions.retry?:
  RetryPolicy`; the low-level `Agent` has only `maxRetryDelayMs`.
- Semantics (goal §Decisions "retry semantics", I6): retry exactly what pi
  classifies as retryable, with pi's counts and delays, including a failed
  response that streamed partial text (discarded as pi does); a response whose
  tool calls were dispatched is never re-sent; tools never execute twice
  (ADR-0424 §6 kept); transport-level retries stay 0. Every attempt is an
  event in history/trace; `retry: { enabled: false }` disables.
- ADR route: ADR-0424 §4 receives a dated §Corrections note (`DEC-2`)
  admitting the agent-level policy; the note names the declined "automatic
  retry during no-COI recovery" (ADR-0376/0377, host command recovery) as a
  different seam.
- Carrier fog (goal map): `AgentHarness` `RetryPolicy` vs a wrapper on the
  low-level `Agent`; shared with the compaction slice.
- Parity cases at PICKUP: same error sequences against the pi CLI 0.85.1 with
  a scripted OpenAI-compatible endpoint (429 ×2 then success; 429 ×4;
  connection reset after partial text; error after a tool call) — attempt
  counts, delays and retained messages must match.
- Fault rows expected at PICKUP (`AGENTS.md` §DoD, network): 429 with any
  `Retry-After` → pi's fixed exponential backoff, the header is not read
  (pi-ai `provider-retry.js:86` throws before its delay logic at transport
  retries 0), the fourth failure ends the run with the provider message;
  error after a dispatched tool call → no retry; abort during backoff →
  settles as aborted.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (defaults, retry semantics, tier).
