---
area: distribution
status: draft
title: Offer an opt-in per-entry text-only message content flag for OpenAI-compatible endpoints that reject content parts
created: 2026-09-27
why: the default transport sends structured content parts; an endpoint that accepts only string content fails, and the host's only escape is a full Pi streamFn that flattens content itself — transport shaping the user wants inside rifty
epic: no-coi-agent-host-kit
sources: [ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/catalog.ts, packages/agent/src/text-content.test.ts]
---

## Context

Built-in native Pi 0.85.1 OpenAI conversion emits user content parts and null
assistant tool-call content. I6 requires a per-entry flag for string-only
endpoints. Native `onPayload` runs after conversion and before network.
ADR-0483 chooses this seam; native model selection remains ADR-0471.

## User scenario

A catalog contains an OpenAI-compatible endpoint accepting only string message
content. The embedder marks that entry, sends a text prompt, completes a file-tool
turn, switches to an ordinary entry and back, retaining history. Images cannot
silently disappear when a flagged entry is selected.

## Acceptance

1. Per-entry `textOnlyContent: true` completes a real standard-file-tool turn via
   the built-in provider; all wire message content is string, tool calls/results
   and retained history survive model switches. → I6 + scenario
2. Flag unset/false preserves native parts; invalid flags fail configuration
   explicitly. Consumers supply no custom streamFn or Pi import. → I6
3. Flagged entries refuse image sends before any request; restored image history
   also fails before network rather than dropping content. → I6 + AGENTS.md
4. Both native stream and streamSimple paths shape the selected entry, including
   retry/compaction; non-content fields remain native. → I6 + ADR-0471

## Fault matrix

| Axis × operation | Honest outcome | Proof |
| --- | --- | --- |
| corrupt-input × nontext content on flagged entry | refuse before network | image/history tests → I6 |
| sibling-drift × switching ordinary/flagged models | selected entry only shapes its wire | retained history switch test → I6 |
| lossy-aggregate × message parts | exact concatenated text, preserve tool_calls/results | real file-tool wire test → I6 |

## Challenge

challenge: 2026-09-30 — clear; reuse accepted I6 premise and user per-entry flag decision; native Pi payload hook is the minimal carrier.

## Decisions

- 2026-09-30 — ADR-0483: per-entry flag on OpenAIModel, native payload hook; no new transport or model-selection form.
