---
area: runtime-js
status: draft
title: WHATWG fromWeb terminal lifecycle, signal, and reason identity
created: 2026-07-12
why: fromWeb adapters split terminal ownership, lose reasons, and loudly reject the still-unsupported valid signal lifecycle
user_story: As a Node program adapting fetch or web streams, I want abort, destroy, and web failures to preserve Node reason identity and event order exactly once.
blocked_by: []
sources: [docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts]
---

## Context

Argument snapshot, validation, acquisition order, cold demand, and invalid-signal
errors now match Node through ADR-0239. Terminal state remains split across read/
write promises, close listeners, and core destroy; valid `{ signal }` is a loud
gap. Node probes still show reason, event, lock-release, opposite-side teardown,
and duplicate/spurious terminal differences.

## Acceptance

- One terminal owner serializes pending read/write/close, explicit destroy,
  signal abort, reader/writer failure, cancel, and abort per adapter.
- Raw reason identity, events, locks, and web teardown match Node v24.16.0.
- Normal and racing terminal matrices pass on one SHA.

## Parity cases

1. Readable/Writable/Duplex explicit destroy during pending operations.
2. Reader or writer one-sided failure; no opposite-side teardown unless Node does it.
3. Pre-aborted and late `{ signal }`: AbortError/ABORT_ERR and raw cause identity.
4. EOF/failure/destroy lock state; each pending operation settles once.

## Out of scope

- Argument validation/acquisition and normal chunk admission/backpressure.
- `toWeb` lifecycle.
- Core non-WHATWG destroy semantics.

## Decisions

Refinement must name one terminal serializer and record any public signal-type change.
