---
area: distribution
status: draft
title: Playground Settings hold the model catalog, the chat picks and switches the model, attaches images to the prompt and other files into the project, and offers another entry after a provider error
created: 2026-09-27
why: The playground is the first embedder of the catalog; without a UI for entries, switching and attachments the user scenarios "one model returns 429 → offer another" and "send a screenshot / a PDF" are not reachable by a user.
user_story: As a developer in the playground, I want to keep several models with their parameters, pick one for the chat, attach a screenshot or a spec file, and switch to another model when the first fails, but today Settings hold one Base URL/model and the chat has no picker, no attach and no switch offer.
epic: agent-weak-models
blocked_by: [distribution/ai-agent-model-catalog, distribution/ai-agent-prompt-images]
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md]
code: [apps/playground/src/ai/settings.ts, apps/playground/src/ai/AiChatPanel.tsx, apps/playground/src/ai/playground-agent-host.ts]
---

## Context

finding — goal slice 3 (I4); after slices 1–2.

- Ours: `apps/playground/src/ai/settings.ts:4-9,24-26` one baseUrl / model /
  apiKey, budgets as constants (`rf.ai.v2`); `AiChatPanel.tsx` has no model
  picker, attach or failure offer; the `/reload` chat command and the
  loaded-resources report already landed (ADR-0440, `chat-command.ts`) — no
  overlap.
- Order: the kit's `distribution/agent-transcript-model` (PR #357) lands
  first and the chat renders from its reducer; this slice adds the picker,
  attach control and switch offer on top (user 2026-09-27 «6 - ок»).
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

- Inherits goal decisions (catalog, images, entry defaults, tier). Automatic fallback is Out of scope (goal map): the UI offers, the user chooses.
