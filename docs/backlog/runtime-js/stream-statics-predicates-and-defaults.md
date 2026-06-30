---
area: runtime-js
status: ready
title: Stream predicates + default-HWM accessors + stream.addAbortSignal
created: 2026-06-28
why: isReadable/isWritable/isErrored/isDisturbed, get/setDefaultHighWaterMark, and stream.addAbortSignal are absent (the last half-built inside fromWeb) — cheap S-effort statics over the existing state machine
user_story: As a dev running a lib that branches on `stream.isReadable(x)` / `isErrored(x)`, reads or sets `stream.getDefaultHighWaterMark(false)`, or calls `stream.addAbortSignal(signal, s)`, I want them to work, but today the predicates and accessors are absent and addAbortSignal is not exported.
epic: whatwg-stream-bridge
sources: [ADR-0034, ADR-0035, docs/public/compat/streams.md]
code: [packages/io/src/streams/index.ts, packages/io/src/streams/readable.ts, packages/io/src/streams/writable.ts]
---

## Context

The predicates `isReadable`/`isWritable`/`isErrored`/`isDisturbed` are not exported from `streams/index.ts`. Default high-water-mark is hardcoded `?? 16 * 1024` at `readable.ts:244` and `writable.ts:83` — no module-level accessor. `stream.addAbortSignal` is half-built (used internally by `Readable.fromWeb`) but not a standalone export. All read the existing `_readable`/`_writableState` — no new machinery.

## Acceptance

- `stream.isReadable(s)`/`isWritable(s)` → `true` only for a not-yet-ended/destroyed Readable/Writable; `false` for the wrong type or a finished/destroyed stream; non-stream input → `false` (never throws).
- `stream.isErrored(s)` → `true` once a stream has errored; `isDisturbed(s)` → `true` once read-from or destroyed (an EXPLICIT disturbed bit, not an approximation).
- `stream.getDefaultHighWaterMark(objectMode)` returns `16384` (bytes) / `16` (objectMode); `setDefaultHighWaterMark(objectMode, n)` changes the value subsequently read by Readable/Writable constructors that don't pass an explicit `highWaterMark`.
- `stream.addAbortSignal(signal, s)` returns `s`; aborting `signal` destroys `s` with an `AbortError` (`code:'ABORT_ERR'`); an already-aborted signal destroys immediately.
An approximation (e.g. `isDisturbed` inferred without a real bit, or `setDefaultHighWaterMark` ignored by ctors) fails this.

## Parity cases

- `isReadable`/`isWritable`/`isErrored`/`isDisturbed` truth tables vs real Node across: fresh, mid-stream, ended, destroyed, errored, and non-stream inputs.
- `getDefaultHighWaterMark(false)` === 16384, `(true)` === 16 (Node v19.9 defaults).
- `setDefaultHighWaterMark(false, 1024)` then `new Readable()` (no explicit HWM) → its `readableHighWaterMark` is 1024; an explicit `{ highWaterMark }` still wins.
- `addAbortSignal(signal, r)`: abort → `r` emits `'error'` with an `AbortError` and is destroyed; passing an already-aborted signal destroys synchronously.

## Out of scope

- `isReadable`/`isWritable` for raw WHATWG web streams (Node accepts some) — only `@riftydev/io` Node streams here; a web stream returns `false`, not a thrown error.
- Per-stream `readableHighWaterMark`/`writableHighWaterMark` getters beyond what already exists — not in this item.

## Decisions

- `isDisturbed` is backed by an EXPLICIT disturbed bit set on first read/destroy (Fidelity — no inference).
- Default HWM becomes two module-level vars in `streams/index.ts`, read by the Readable/Writable ctors in place of the hardcoded `?? 16 * 1024`.
- `addAbortSignal` is extracted from `fromWeb`'s inline abort logic into a standalone export (no behavior change to `fromWeb`).
- REVERSIBLE — additive statics, no ADR; CHANGELOG line + compat ✅ flips.

## Reversibility

REVERSIBLE — additive predicates/accessors over the existing state machine; CHANGELOG line.
