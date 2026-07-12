---
area: runtime-js
status: draft
title: Readable.from iterator lifecycle ownership
created: 2026-07-12
why: Readable.from does not own iterator acquisition, async values, pending next, and terminal cleanup like Node
user_story: As a CLI streaming an async generator, I want cancellation, errors, and backpressure to stop and close the generator exactly once without leaking work.
blocked_by: []
sources: [docs/adr/runtime-js/0238-readable-from-defaults-to-object-mode.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

ADR-0238 now owns default mode, special string/Buffer boundaries, initial HWM,
and cold start. This item owns the remaining generic iterator protocol and teardown:
rifty does not call `throw`/`return`, await sync-iterator Promise values or
cleanup, reject null with `ERR_STREAM_NULL_VALUES`, or serialize a pending async
`next()` through destruction.

## Acceptance

- One source owner serializes demand, pending `next`, push, destroy, and cleanup.
- Natural exhaustion, break, destroy, and error call `throw`/`return` exactly as
  Node v24.16.0, awaiting cleanup before close and aggregating cleanup failures.
- Sync/async iterators, promised sync values, null, HWM refill, and late pending
  results match Node on one SHA.

## Parity cases

1. Iterator getter/call order; zero `next()` before demand; HWM refill counts.
2. At most one pending async `next()`; late completion after destroy ignored.
3. Natural exhaustion/break call `return()` once; cleanup Promise before close.
4. `destroy(error)` uses `throw(error)`, then conditional `return()`; aggregate errors.
5. Promised sync values awaited; null rejects `ERR_STREAM_NULL_VALUES`.

## Out of scope

- Default mode/special/initial HWM: ADR-0238.
- `Duplex.from` source ownership.
- Core byte-mode chunk admission and sized-read HWM projection.

## Decisions

Refinement must choose one reusable iterable-source owner before `ready`.
