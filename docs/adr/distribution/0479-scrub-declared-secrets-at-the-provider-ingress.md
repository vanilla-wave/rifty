# ADR 0479: Scrub declared secrets at the provider ingress

Status: Accepted
Date: 2026-09-28

> TL;DR: provider error text is masked once when a response enters the session; model-visible content stays raw; export no longer redacts.

## Context

ADR-0471 decision 4 redacted keys and catalog headers only in `exportTrace()`; provider echoes
still left via `message_end` (persisted history), `status` detail (Playground UI) and
`retry`/`compaction` errors. All header values were implicit secrets replaced in every trace
string: a header `edit_file` masked tool names, patched by a 60-tag allowlist. ADR-0436 left
custom-transport credentials to the embedder with no way to declare them.

## Decision

1. `continuation.ts` scrubs the `errorMessage` of each request attempt's final
   `AssistantMessage` before accounting, overflow/retry classification, emission or retry
   receipts, and of each compaction summary response; compaction failure strings and the
   `message` of an `Error` thrown out of a request (in place, same object) too. `content`
   (text, thinking, tool calls) is never altered. Token: `[redacted]`.
2. Secrets = apiKeys of built-in `createOpenAIProvider` providers currently in `models` (read
   per response) ∪ `AgentSessionOptions.secrets` (exact strings, empty ignored, copied at
   creation). Each also masks in its JSON-escaped form: pi formats HTTP error bodies as
   `<status>: <JSON>`. Headers are not implicit secrets; embedders declare private ones
   (Playground: values of headers named auth/key/token/secret/cookie/session, plus the bare
   `Bearer` token; a non-credential match such as `Idempotency-Key` is masked too).
3. `trace.ts` and export-time redaction are deleted; `exportTrace()` returns a detached copy.

## Alternatives

- Export-time blanket redaction: rejected; history, status and events leak before export.
- Treating all headers as secret: rejected; corrupts ordinary text and tool names.
- Scrubbing assistant text/thinking too: rejected; the model reads them back, so a short key
  (`lm-studio`, `test`, `1`) rewrites ordinary text and signed thinking breaks. A key reaches
  content only from context already holding it (user text, tool results), which stays raw.

## Consequences

- Error-only: transcript differs from pi-verbatim only in secret substrings of provider error
  text (the `<status>: <body>` pi never sends back to the model); classification sees the
  scrubbed text (declare credentials, not classifier phrases).
- Model-visible content is never altered, so short keys cannot corrupt context; a model echoing
  a key in text/thinking keeps it raw in history and trace.
- Thrown-exception path covered: an `Error` a `Models` implementation throws is scrubbed before
  Agent normalizes it into history/status (pi's own catalog returns error messages instead).
- Streamed `message_update` deltas and content stay raw by design; error text never streams.
- Not scrubbed: assistant content, tool-call arguments, tool results, user text, provider
  `diagnostics`, non-`Error` throws; a secret cut by pi's 4000-char error-body truncation leaves
  its prefix. agent-bench keeps its masking.
