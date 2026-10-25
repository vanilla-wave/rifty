# ADR 0483: Text-only message content on OpenAI catalog entries

Status: Accepted
Date: 2026-09-30

## Context

PR357 goal I6; ADR-0436/0471 keep transport in rifty over native Pi Models.
Pi0.85.1 sends user text parts and nullable assistant tool-call content.
String-only endpoints reject that payload; the embedder must not write a transport.

## Decision

- Add optional boolean `textOnlyContent` to built-in OpenAI catalog entries.
  Unset/false preserves native conversion. Capture and validate at provider creation.
- A flagged entry accepts text input only, even if its supplied input lists images.
  Existing session admission rejects images before dispatch. Historical image parts
  reaching the provider also fail explicitly before network; never drop them.
- Shape native `onPayload` output: concatenate text parts without inserted separators,
  preserve strings, convert null/missing content to empty string. Preserve roles,
  tool calls, reasoning and all non-content fields. Apply to both native streaming
  entry points, so compaction/retry/switches use the selected entry's policy.
- Caller `onPayload`, when using the native provider directly, runs first; final
  shaping still enforces the explicitly selected string-only content contract.

## Alternatives

- Native payload hook: selected, after Pi's provider conversion, before request.
- New fetch/stream transport: duplicates native auth/retry/conversion machinery.
- Rewrite only user input before Pi: misses assistant null and reasoning text parts.
- Flatten silently dropping image blocks: violates I6/Fidelity.
