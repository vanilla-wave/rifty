---
area: distribution
status: ready
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
- Cross-goal (user 2026-09-27, three-goal review): the no-COI kit
  (`epics/no-coi-agent-host-kit`, PR #357) uses this catalog too — its
  per-turn `settings` item is removed («1 - a»), its reference host creates
  the session from a one-entry catalog, and its text-only content mode is a
  per-entry flag of this entry shape («2 - a»), no session-level toggle; the
  ADR here is the only supersession of ADR-0436 §2/§3. This slice also
  migrates the bench lanes, ahead of the kit's no-COI lane swap and the
  quality goal's runner restructuring (goal §Decisions "shared bench order").

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Reference contract

- pi-ai / pi-agent-core 0.85.1; native Models, createProvider, streamSimple
  and Agent.prepareNextTurnWithContext. Executed oracle probes and RED output:
  `reference/ai-agent-model-catalog-evidence.md`.

## Acceptance

1. Session admits only native Models + selected id; removed settings/streamFn
   forms and invalid ids fail before host work. → I1
2. Effective model limits, reasoning, sampling and transport match native pi;
   trace config names those values and redacts built-in keys and catalog headers. → I1
3. setModel applies on the next request, including an active tool turn;
   provider errors preserve prior tool results for the next send; model events
   make switches observable. → I2
4. Playground, bench and installed-consumer fixtures migrate to the catalog;
   their existing real host acceptance remains green. → I1

## Parity cases

1. Native pi streamSimple and rifty send the same selected model, output
   limit, temperature, top_p and reasoning_effort. → I1
2. Native pi active model selection retains prior user/tool messages at the
   next request; rifty retains them across a provider failure and send. → I2

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| provider error × selected request | error, retained history, no replay | catalog.test.ts active-switch test | → I2 |
| invalid id × admission | throw before host work | catalog.test.ts admission test | → I1 |
| credential in provider error × export | redacted export, effective metadata | catalog.test.ts redaction test | → I1 |

## Out of scope

Images, catalog editor, retry/compaction and tool hygiene stay in their linked
goal slices. Tool image results remain `agent.tool-image-result` ❌.

## Decisions

- Inherits goal decisions (catalog, setModel timing, entry defaults, sampling, public API and ADRs, tier). Carrier questions live on the goal map §Open questions.

- 2026-09-27 — ADR-0471 records DEC-2 independent catalog decision; preparation covers I1/I2 only, mechanisms wait for I12.
