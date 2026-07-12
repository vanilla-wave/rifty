---
area: runtime-js
status: draft
title: Stream byte chunk kinds and invalid-value rejection
created: 2026-07-12
why: core admission now pins string Buffer and plain Uint8Array, but other views and invalid values still diverge
user_story: As a Node stream producer, I want every byte chunk kind accepted or rejected exactly like Node without silent object delivery.
blocked_by: []
sources: [docs/adr/runtime-js/0237-readable-owns-read-hook-dispatch-and-demand-latch.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/writable.ts]
---

## Context

The covered admission boundary preserves Buffer identity and wraps plain
Uint8Array views. Byte-mode object/number values are still accepted instead of
throwing, while DataView and other TypedArrays do not yet follow Node's Buffer
conversion. The same classification must not drift across stream surfaces.

## Acceptance

- One byte-chunk classifier covers Readable and Writable cores.
- Buffer, every supported ArrayBufferView, strings, and invalid primitive/object
  values match Node type, identity/backing, encoding, error, and HWM behavior.
- Duplex, Transform, and fromWeb siblings inherit the core result.

## Parity cases

1. Buffer, Uint8Array offset view, DataView, and non-Uint8 TypedArrays.
2. Object, number, bigint, symbol, function, null/undefined per operation.
3. Readable/Duplex/fromWeb and Writable/Duplex/Transform/fromWeb sibling matrix.

## Out of scope

- Covered string/Buffer/plain-Uint8Array admission from ADR-0237.
- Readable demand/refill and Writable dispatch timing.

## Decisions

Refinement must pin Node's copy-versus-shared-backing behavior for each view.
