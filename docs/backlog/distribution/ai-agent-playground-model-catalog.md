---
area: distribution
status: ready
title: Playground Settings hold the model catalog, the chat picks and switches the model, attaches images to the prompt and other files into the project, and offers another entry after a provider error
created: 2026-09-27
why: The playground is the first embedder of the catalog; without a UI for entries, switching and attachments the user scenarios "one model returns 429 → offer another" and "send a screenshot / a PDF" are not reachable by a user.
user_story: As a developer in the playground, I want to keep several models with their parameters, pick one for the chat, attach a screenshot or a spec file, and switch to another model when the first fails, but today Settings hold one Base URL/model and the chat has no picker, no attach and no switch offer.
epic: agent-weak-models
blocked_by: []
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md]
code: [packages/agent/src/session.ts, packages/agent/src/types.ts, apps/playground/src/ai/settings.ts, apps/playground/src/ai/AiChatPanel.tsx, apps/playground/src/ai/playground-agent-host.ts]
---

## Context

Catalog I1/I2 is delivered (Final+GREEN c5bb64273). This unit absorbs draft
`distribution/ai-agent-prompt-images` and connects native image input to the
Playground catalog/picker/attachment flow (I3/I4). Existing /reload and resource
report stay. The no-COI kit's transcript reducer follows this whole goal.

The browser has a built-in OpenAI-compatible transport; external embedders
register custom native Providers. The catalog editor exposes native model
fields and thinking/sampling defaults. Provider keys and headers remain in
memory. Other file bytes go through public ProjectFiles into /attachments;
text tools keep refusing binary reads. No automatic model fallback.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Reference contract

- pi-agent-core/pi-ai 0.85.1: Agent.prompt(text, ImageContent[]) and native
  OpenAI serialization. `packages/agent/src/images.test.ts` executes the same
  prompt against native pi and rifty, including image-only input.
- Project attachments use public ProjectFiles.writeFile with expectedVersion:null;
  existing file bytes are never overwritten implicitly.

## Acceptance

1. send(prompt, images?) preserves native ImageContent in provider input and
   trace, including a prompt with images and empty text, matching pi. → I3
2. Text-only entries reject image sends before dispatch, naming the entry;
   non-image binary input throws agent.prompt-binary-input, listed compat ❌;
   tool image results remain unsupported. → I3
3. Settings hold native catalog fields and per-entry thinking/sampling;
   defaults 128000/8192/off for new entries; catalog/selection persist,
   credentials and run limits remain memory-only. → I4
4. Chat picker selects a model through setModel without losing history;
   a provider error offers another entry and continuation; the next request
   has that entry's effective defaults and prior tool results. → I4 + I2
5. File picker attaches images to the prompt; other files are written byte-for-byte
   into the project through ProjectFiles, and their visible paths enter the
   prompt. Existing project files are preserved. → I4 + scenario

## Parity cases

1. The same image+text and image-only prompts produce identical native pi/rifty
   user content on the wire and keep native images in the trace. → I3

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| text-only model × image send | named refusal, zero requests | images.test.ts | → I3 |
| non-image bytes × model prompt | NotImplementedError, zero requests | images.test.ts | → I3 |
| provider error × UI continuation | other model, history retained, no tool replay | ai-mode.spec.ts catalog controls | → I4 + I2 |
| project filename collision × attach | unique path or visible failure; prior bytes preserved | ai-mode.spec.ts binary attachment collision | → I4 + scenario |

## Out of scope

Tool image results remain agent.tool-image-result ❌. Non-image model input
remains agent.prompt-binary-input ❌. Automatic fallback is not added.
Compaction/context-exceeded UI remains linked to I5 after the baseline.

## Decisions

re-cut: 2026-09-27 — absorb draft predecessor distribution/ai-agent-prompt-images into this image/catalog chat unit; preserve I3/I4 and all existing scenarios — trace: none

- Inherits goal decisions (catalog, images, entry defaults, tier). Automatic fallback is Out of scope (goal map): the UI offers, the user chooses.

- 2026-09-27 — carrier: existing simple Base URL/Model/key controls plus native catalog JSON in an advanced section; keys scoped to provider, memory-only; browser built-in transport remains OpenAI-compatible, external embedders register other native Providers (ADR-0471).
- 2026-09-27 — attachment carrier: file picker, images kept in the composer until admitted; binary files stored under /attachments with collision-safe names and expectedVersion:null; paths shown and appended to the sent prompt (I4, ProjectFiles authority).
- 2026-09-27 — image-only prompts follow the executed pi oracle; empty text without images keeps its existing refusal (I3, unchanged baseline).
- 2026-09-27 — source/authority: user chose catalog-only, manual switching and images-to-model/other-files-to-project; these are I3/I4, inherited scope check; no new user fork. Shape/UI/file folder are route decisions.
