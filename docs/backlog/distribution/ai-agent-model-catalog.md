---
area: distribution
status: draft
title: Make an embedder-supplied pi-ai model catalog with per-entry parameters and transports the only session form, select the model and switch it mid-session, and record the selected entry in the trace
created: 2026-09-27
why: The session builds one hardcoded Model (reasoning off, 8192 output tokens, 128k window) behind two exclusive transport forms and ADR-0436 §2 forbids a catalog or model selection; the user expects a list of models with parameters, a way to call each, and switching in a session when one fails — and chose to drop the legacy forms.
user_story: As a developer embedding the agent, I want to hand it my models with thinking, limits, sampling and compat and switch between them in a session (a 429 on one → offer another), but today `settings` is one baseUrl/model, `streamFn` carries no model description, and the Model fields are constants in session.ts.
epic: agent-weak-models
blocked_by: []
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, docs/adr/distribution/0436-publish-agent-with-native-custom-stream-transport.md]
code: [packages/agent/src/session.ts, packages/agent/src/types.ts, packages/agent/src/index.ts]
---

## Context

finding — goal slice 1 (I1, I2); leads every other slice.

- Ours: `packages/agent/src/session.ts:35-49` builds the pi `Model` with
  `reasoning: false`, `contextWindow: 128_000`, `maxTokens: 8192`,
  `input: ['text']`, no temperature/top_p/compat; `types.ts:127-139` two
  exclusive forms (`settings` + optional `fetch`, or `streamFn` with
  `settings?: never`); trace `config` (`types.ts:162-173`) records budgets
  only. ADR-0436 §2: "No second callback, provider catalogue or
  model-selection API"; §3: custom transport uses pi's unknown model state.
- Reference (evidence §pi 0.85.1): pi-ai `Models` registry — `createModels()`,
  `setProvider(provider)`, `getModel(provider, id)`, `streamSimple(model,
  context, options)` (`models.d.ts:92-158`); `Model` fields incl. `input:
  ("text" | "image")[]`, `contextWindow`, `maxTokens`, `reasoning`, `compat:
  OpenAICompletionsCompat` (`supportsReasoningEffort`, reasoning-content
  replay, `thinkingTokenBudgetField`); request `temperature`; `ThinkingLevel`;
  pi CLI `setModel(model, options)` sets `agent.state.model`
  (`agent-session.js:1260`) and the next `prepareNextTurnWithContext` reads it
  (`:293-305`) — a switch applies from the next request, also mid-run.
- After this slice: `createAgentSession({ models, model, maxToolCalls?,
  runTimeoutMs?, … })` is the only form — `models` is the embedder's catalog
  (pi `Model` entries + per-entry request defaults + the transport per
  provider: built-in OpenAI-compatible fetch path or a pi `Provider` /
  `StreamFn`), `model` the initial selection; `contextWindow`/`maxTokens`
  required per entry, optional fields per goal §Decisions "entry defaults";
  `session.setModel(id)` (I2); events report the switch; trace `config`
  records the selected entry's effective values, keys redacted (ADR-0436 §3
  metadata rule kept for the transcript). The `settings`/`streamFn` forms are
  removed (user: «Убрать форму, только каталог») — the playground and
  agent-bench lanes migrate in this slice; `retry`/`compaction` options are
  NOT introduced here (slices 6/7), so the slice-4 baseline precedes them.
- Carrier notes for PICKUP: one ADR (`pnpm adr:new distribution`) for the
  public API — catalog as the only form, `setModel`, `send(prompt, images)`
  (slice 2 cites it), `context-exceeded` (slice 7 cites it) — superseding
  ADR-0436 §2 and §3 (`DEC-2`: dated §Corrections note in 0436); probe pi-ai's
  handling of unset `max_tokens`/`temperature` (map fog) and the
  AgentHarness-vs-Agent carrier. Null case first: a one-entry catalog with
  today's values behaves as today's `settings` session.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (catalog, setModel timing, entry defaults, sampling, public API and ADRs, tier). Carrier questions live on the goal map §Open questions.
