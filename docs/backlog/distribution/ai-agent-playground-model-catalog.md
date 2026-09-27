---
area: distribution
status: draft
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

Absorbs `distribution/ai-agent-prompt-images`: native `send(prompt, images?)`
for image-capable entries; text-only entries fail before provider dispatch;
non-image binary input throws `agent.prompt-binary-input`. Tool image results
remain unsupported. I3/I4 scope unchanged.

finding — goal slice 3 (I4); after slices 1–2.

- Ours: `apps/playground/src/ai/settings.ts:4-9,24-26` one baseUrl / model /
  apiKey, budgets as constants (`rf.ai.v2`); `AiChatPanel.tsx` has no model
  picker, attach or failure offer; the `/reload` chat command and the
  loaded-resources report already landed (ADR-0440, `chat-command.ts`) — no
  overlap.
- Order: goals run in sequence (this goal first); the kit's transcript
  reducer `distribution/agent-transcript-model` (PR #357) lands afterwards
  and covers this slice's chat events (goal §Decisions "shared bench order").
- After this slice: Settings edit catalog entries (the I1 fields; a new entry
  prefilled with today's values 128 000 / 8192 / thinking off; persisted like
  today's fields, keys memory-only as today); the chat shows the selected
  entry and switches via `session.setModel`; the composer has one attach
  control — an image goes to the prompt (`send(prompt, images)`, slice 2), any
  other file is written into the project through the Workbench project files
  API (folder: map fog) and its path is shown and inserted into the prompt
  (user: «остальное — файлом в проект»; agent text tools keep rejecting
  binary content, `workbench-host.ts:13-16`); when a run ends in `error` from
  a provider failure, the chat offers switching to another entry and
  continuing the retained history. The `context-exceeded` offer and the
  compaction marker are slice 7's UI half (their events do not exist before
  it).
- Carrier notes for PICKUP: solid-js stays playground-only (D-002); the
  no-COI page in agent-bench uses the packed SDK/agent and its own minimal UI
  — the bench takes the catalog entry from config (slice 4), not from this UI.
  e2e: Playwright over the real +chat controls as in the existing agent-bench
  rifty lane; the file attach reuses the Workbench project file API (no new
  upload mechanism).

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

re-cut: 2026-09-27 — absorb draft predecessor distribution/ai-agent-prompt-images into this image/catalog chat unit; preserve I3/I4 and all existing scenarios — trace: none

- Inherits goal decisions (catalog, images, entry defaults, tier). Automatic fallback is Out of scope (goal map): the UI offers, the user chooses.
