---
area: runtime-js
status: draft
title: Readable async-iterator helpers (map/filter/forEach/reduce/toArray/take/drop/flatMap/some/every/find/iterator)
created: 2026-06-28
why: the v17→v22 Readable async-iterator helper surface is absent; the base [Symbol.asyncIterator] exists (readable.ts:682) — these are lazy transforms over it, rising ecosystem use
user_story: As a dev running a lib that does `readable.map(fn).filter(pred)` or `await readable.toArray()` / `readable.reduce(...)`, I want the helpers to work, but today only the base async-iteration protocol exists and the helper methods are absent.
epic: whatwg-stream-bridge
sources: [ADR-0034, docs/research/node-parity-gaps-unbacklogged-2026-06-20.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

`Readable`'s base `[Symbol.asyncIterator]()` is implemented (`readable.ts:682`, with break/return/throw cleanup), but the helper statics — `map`, `filter`, `forEach`, `reduce`, `toArray`, `take`, `drop`, `flatMap`, `some`, `every`, `find`, `iterator(options)` — are absent. They are lazy transforms over the existing async iterator.

## Clear path (resolve at refine)

- Each helper consumes `[Symbol.asyncIterator]()` and returns either a new `Readable` (`map`/`filter`/`flatMap`/`take`/`drop`) or a promise (`forEach`/`reduce`/`toArray`/`some`/`every`/`find`); `iterator({ destroyOnReturn })` controls cleanup on early return.
- **Forks to settle:** the `{ concurrency }` option for `map`/`filter`/`forEach`/`flatMap` — default (1), ordering guarantee under concurrency > 1, and error-fail-fast vs drain semantics; `AbortSignal` option propagation (abort → destroy mid-iteration with `AbortError`); whether helpers are instance methods or also `Readable.prototype` statics matching Node's exact placement. Each fork becomes a parity case (real Node vs rifty) before the compat ❌ flip.
- L-effort; decoupled from the WHATWG bridge — can land independently.

## Reversibility

REVERSIBLE — additive lazy transforms over the existing async iterator; no ADR (ADR-0154 leaves the surface unclaimed); CHANGELOG line + compat ✅ flip on completion.
