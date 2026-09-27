---
area: distribution
status: draft
title: Offer an opt-in text-only message content mode for OpenAI-compatible endpoints that reject content parts
created: 2026-09-27
why: the default transport sends structured content parts; an endpoint that accepts only string content fails, and the host's only escape is a full Pi streamFn that flattens content itself — transport shaping the user wants inside rifty
epic: no-coi-agent-host-kit
blocked_by: [distribution/agent-per-turn-settings]
sources: [ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/session.ts, packages/agent/src/types.ts]
---

## Context

Finding. The default transport is pi-ai's `streamSimple` for
`openai-completions` (`packages/agent/src/session.ts:3,99`); pi-ai 0.85.1
serialises message content as parts and exposes provider quirks through
`Model.compat` (`OpenAICompletionsCompat`: `supportsDeveloperRole`,
`requiresToolResultName`, `thinkingFormat`, …) with no string-content flag
visible in `dist/types.d.ts:465-500`. Issue #345's host flattened content to a
string inside its own `streamFn`. Per the user's 2026-09-27 decision, anything
that shapes what the model receives is a rifty obligation, not host code.

Goal obligation: I6 — an opt-in text-only content mode over `settings` +
`fetch` completes the scenario turn against a string-only endpoint, without a
consumer `streamFn` or a direct pi-ai dependency. Seam addition on ADR-0436 →
short ADR citing it at pickup.

## Out of scope

- Multimodal / image content (unsupported today, `packages/agent/README.md`).
- Auto-detection of endpoint capabilities; the mode is explicit.

## Decisions

- carrier (rifty-side conversion before `streamSimple` vs an upstream pi-ai
  compat flag) at pickup; after `agent-per-turn-settings` (same transport
  code path).
