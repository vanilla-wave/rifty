---
area: distribution
status: draft
title: Pass images with a prompt to an image-capable catalog entry as pi ImageContent, fail loudly on text-only entries, and refuse non-image binary input with NotImplementedError
created: 2026-09-27
why: The user expects to send images to the model; `send` takes a string only, and pi 0.85.1 carries images natively but no other binary prompt input (those files go into the project — slice 3).
user_story: As a developer using the playground or embedded agent, I want to attach a screenshot to my prompt, but today `send(prompt: string)` has no image parameter and the Model's `input` is hardcoded to text.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-model-catalog]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md]
code: [packages/agent/src/session.ts, packages/agent/src/types.ts, packages/agent/src/tools.ts]
---

## Context

finding — goal slice 2 (I3); after slice 1 (entries carry `input`).

- Ours: `types.ts:189` `send(prompt: string)`; `session.ts:46` `input:
  ['text']`; `tools.ts:386` tool image results throw
  `NotImplementedError('agent.tool-image-result')` (README compat ❌).
- Reference: pi-ai `ImageContent` (`types.d.ts:251`), `Model.input: ("text" |
  "image")[]` (`:728`); `pi-agent-core` `Agent.prompt(input: string, images?:
  ImageContent[])` (`agent.d.ts:109`). pi-ai 0.85.1 has no other binary prompt
  input; it does carry image blocks in tool results
  (`openai-completions.js:1093-1103`) — that ❌ is rifty's own and stays
  (goal §Decisions "images").
- After this slice: `send(prompt, images?)` forwards images as `ImageContent`
  when the selected entry's `input` lists `image`; a text-only entry fails
  before any request with an error naming the entry; non-image binary input
  throws `NotImplementedError('agent.prompt-binary-input')`; the agent README
  compat table lists both ❌ rows (binary prompt input, tool image results).
  Trace retains the image parts as pi's transcript does.
- Carrier notes for PICKUP: the ADR from slice 1 covers the signature change;
  bench tasks carry no images (no bench change); the playground attach UI
  (image → prompt, other file → project) is slice 3.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (images, public API and ADRs, tier).
