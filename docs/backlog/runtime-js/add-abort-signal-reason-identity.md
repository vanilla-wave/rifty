---
area: runtime-js
status: draft
title: addAbortSignal reason identity
created: 2026-07-12
why: addAbortSignal creates AbortError without preserving signal.reason as cause
user_story: As a pipeline owner aborting with a sentinel reason, I want stream errors to retain that reason in AbortError.cause exactly like Node.
blocked_by: []
sources: [docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

Rifty destroys with `AbortError`/`ABORT_ERR` but discards `signal.reason`. Node
exposes the raw reason as `error.cause` for pre-aborted and later-aborted signals.

## Acceptance

- Pre/late abort preserve `error.cause === signal.reason` by identity.
- Listener cleanup and terminal event order match Node across stream halves.
- Focused parity and regression tests pass on one SHA.

## Parity cases

1. Raw object reason before attachment and after attachment.
2. Abort after natural completion produces no second terminal event.

## Out of scope

- `fromWeb({ signal })` and async-iterator helper signals.

## Decisions

Refinement must establish Node validation and timing before `ready`.
