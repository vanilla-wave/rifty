---
area: runtime-js
status: ready
title: Readable.from Node source defaults
created: 2026-07-12
why: Readable.from infers byte mode and consumes the first sync entry before demand instead of applying Node defaults
user_story: As a CLI consuming iterable strings or Buffers, I want Node chunk boundaries, identity, HWM, and cold iterator behavior.
blocked_by: [runtime-js/readable-read-hook-and-chunk-admission]
sources: [docs/adr/runtime-js/0238-readable-from-defaults-to-object-mode.md, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/duplex.ts]
---

## User scenario

A CLI streams iterable strings/Buffers through `Readable.from` or `Duplex.from`
and observes the same chunks, identity, HWM, and cold start as real Node.

## Acceptance

- Generic sources use `{ objectMode:true, highWaterMark:1, ...options }`.
- Bare string/Buffer use `{ objectMode:true, ...options }` and emit once; bare
  Uint8Array keeps numeric iterator entries.
- Own `undefined`/`null`/explicit values overwrite defaults exactly like Node.
- No iterator `next()` occurs before demand; HWM 0 progresses to data and EOF.
- `Duplex.from` inherits covered default mode and special-source boundaries.

## Parity cases

1. Sync/async arrays, bare non-ASCII/empty string, Buffer identity, Uint8Array.
2. Default/explicit/own-undefined mode and HWM; special vs generic HWM.
3. Cold iterator next count; flowing and paused HWM 0 with `read()`/`read(1)`.
4. Delegated Duplex string/empty/Buffer/array boundaries and identity.

## Out of scope

- Iterator throw/return/pending-next lifecycle.
- Direct single-owner Duplex iterable path and core byte admission.

## Decisions

Implement ADR-0238 without first-entry inference or compatibility fallback.
