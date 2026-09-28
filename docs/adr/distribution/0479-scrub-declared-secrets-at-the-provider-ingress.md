# ADR 0479: Scrub declared secrets at the provider ingress

Status: Accepted
Date: 2026-09-28

> TL;DR: provider text is masked once when a response enters the session; export no longer redacts.

## Context

ADR-0471 decision 4 redacted keys and catalog headers only in `exportTrace()`; provider echoes
still left via `message_end` (persisted history), `status` detail (Playground UI) and
`retry`/`compaction` errors. All header values were implicit secrets replaced in every trace
string: a header `edit_file` masked tool names, patched by a 60-tag allowlist. ADR-0436 left
custom-transport credentials to the embedder with no way to declare them.

## Decision

1. `continuation.ts` scrubs each request attempt's final `AssistantMessage` before accounting,
   overflow/retry classification, emission or retry receipts, and each compaction summary
   response. Fields: `errorMessage`, `text`/`thinking` of text/thinking blocks. Retry and
   compaction error strings are scrubbed too. Token: `[redacted]`.
2. Secrets = apiKeys of built-in `createOpenAIProvider` providers currently in `models` (read
   per response) ∪ `AgentSessionOptions.secrets` (exact strings, empty ignored, copied at
   creation). Each also masks in its JSON-escaped form: pi formats HTTP error bodies as
   `<status>: <JSON>`. Headers are not implicit secrets; embedders declare private ones
   (Playground declares every catalog header value).
3. `trace.ts` and export-time redaction are deleted; `exportTrace()` returns a detached copy.

## Alternatives

- Export-time blanket redaction: rejected; history, status and events leak before export.
- Treating all headers as secret: rejected; corrupts ordinary text and tool names.

## Consequences

- Transcript differs from pi-verbatim only in secret substrings of provider text;
  classification sees the scrubbed text (declare credentials, not classifier phrases).
- Streamed `message_update` deltas stay raw; `message_end` replaces them. Error text never streams.
- Not scrubbed: tool-call arguments, tool results, user text, provider `diagnostics`; a secret
  cut by pi's 4000-char error-body truncation leaves its prefix. agent-bench keeps its masking.
