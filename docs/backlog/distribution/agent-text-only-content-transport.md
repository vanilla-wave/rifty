---
area: distribution
status: draft
title: Offer an opt-in per-entry text-only message content flag for OpenAI-compatible endpoints that reject content parts
created: 2026-09-27
why: the default transport sends structured content parts; an endpoint that accepts only string content fails, and the host's only escape is a full Pi streamFn that flattens content itself — transport shaping the user wants inside rifty
epic: no-coi-agent-host-kit
sources: [ADR-0436, docs/backlog/distribution/reference/no-coi-agent-host-kit-evidence.md]
code: [packages/agent/src/session.ts, packages/agent/src/types.ts]
---

## Context

Finding. The default transport is pi-ai's `streamSimple` for
`openai-completions` (`packages/agent/src/session.ts:3,99`); pi-agent-core
builds user content as parts and pi-ai 0.85.1 sends user parts as arrays
(assistant/tool/system go as strings); `Model.compat`
(`OpenAICompletionsCompat`, `dist/types.d.ts:465-500`) exposes provider
quirks with no string-content flag, and rifty passes no `compat`
(`grep -n compat packages/agent/src/session.ts` → 0). Issue #345's host
flattened content inside its own `streamFn`. Per the user's 2026-09-27
decision, anything that shapes what the model receives is a rifty obligation.

Goal obligation: I6 — an opt-in text-only content flag on the model-catalog
entry (`epics/agent-weak-models` I1, `distribution/ai-agent-model-catalog`,
PR #359 — lands first) completes the scenario turn on the built-in `fetch`
transport against a string-only endpoint, without a consumer `streamFn` or a
direct pi-ai dependency; `send` with images to a flagged entry fails before
any request (agent-weak-models I3 path). Seam addition on ADR-0436 and the
catalog ADR → short ADR citing both at pickup.

## Out of scope

- Images to a flagged entry — refused before any request; image transport
  itself is agent-weak-models I3.
- Auto-detection of endpoint capabilities; the flag is explicit.
- Other per-entry fields (context window, max tokens, reasoning, `compat`) —
  the catalog entry (agent-weak-models I1).

## Decisions

- carrier (rifty-side conversion before `streamSimple` vs an upstream pi-ai
  compat flag) at pickup; the flag is a field of the catalog entry, not a
  session option (user 2026-09-27 «2 - a»); after
  `distribution/ai-agent-model-catalog` (agent-weak-models item 1, PR #359).
