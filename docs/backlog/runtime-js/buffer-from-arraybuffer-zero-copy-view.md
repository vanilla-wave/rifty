---
area: runtime-js
status: draft
title: Buffer.from(arrayBuffer) copies instead of aliasing the backing ArrayBuffer (Node view-semantics divergence, untracked)
created: 2026-06-13
why: Buffer.from(arrayBuffer) copies while Node returns a Buffer that views the same backing ArrayBuffer — a silent behavioral divergence flagged deferred in ADR-0030 with no consumer hit yet; the compat row is a bare ✅ that masks it.
user_story: As a dev whose code does `Buffer.from(arrayBuffer)` then mutates the source `ArrayBuffer` expecting the Buffer to see it (Node view-semantics), I want that aliasing; currently rifty copies, so writes through one are invisible to the other.
sources: [ADR-0030, docs/public/compat/buffer.md:14]
code: [packages/io/src/buffer.ts, packages/runtime-js/src/builtins/buffer.ts]
---

## Context

io/buffer.ts:168-173: when value instanceof ArrayBuffer it constructs new Uint8Array(value,offset,length), copies into a fresh Buffer via out.set(src), and returns it — so mutating the source ArrayBuffer (or the Buffer) is not reflected in the other, unlike Node. ADR-0030 Consequences/Follow-ups flag this as a low-priority deferred follow-up, no consumer hit yet. buffer-pending-statics.md covers only the static surface (poolSize/constants/transcode/kMaxLength), not from(arrayBuffer). Buffer.from(uint8) copying is correct and stays.

## Options or Next

Gate on a real consumer. When one lands: in the ArrayBuffer branch, when offset/length yield a full/sub-range view, return a Buffer that aliases the passed ArrayBuffer via the (buffer, byteOffset, length) typed-array constructor instead of copying. Add a parity case asserting mutation aliasing in both directions plus the offset/length overload; flip compat buffer.md row 14's caveat. Land with the parity test first (switching copy→view is observable).

## Reversibility

REVERSIBLE — backlog item; behavior change confined to one branch of Buffer.from in @riftydev/io, no cross-package API change. Land parity-test-first and update the compat caveat.
