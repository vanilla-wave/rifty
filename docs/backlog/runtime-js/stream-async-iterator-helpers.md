---
area: runtime-js
status: ready
title: Readable async-iterator helpers (map/filter/forEach/reduce/toArray/take/drop/flatMap/some/every/find/iterator)
created: 2026-06-28
why: the v17→v22 Readable async-iterator helper surface is absent; the base [Symbol.asyncIterator] exists (readable.ts:703) — these are lazy transforms over it, rising ecosystem use
user_story: As a dev running a lib that does `readable.map(fn).filter(pred)` or `await readable.toArray()` / `readable.reduce(...)`, I want the helpers to work, but today only the base async-iteration protocol exists and the helper methods are absent.
epic: whatwg-stream-bridge
sources: [ADR-0034, docs/research/node-parity-gaps-unbacklogged-2026-06-20.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

`Readable`'s base `[Symbol.asyncIterator]()` is implemented (`readable.ts:703`, with break/return/throw cleanup), but the helper methods — `map`, `filter`, `forEach`, `reduce`, `toArray`, `take`, `drop`, `flatMap`, `some`, `every`, `find`, `iterator(options)` — are absent. They are lazy transforms over the existing async iterator, living on `Readable.prototype` (Node v17+ places them there).

## Acceptance

- All 12 methods exist on `Readable.prototype`. Stream-returning helpers (`map`/`filter`/`flatMap`/`take`/`drop`) return a `Readable` (`objectMode:true`); promise-returning helpers (`forEach`/`reduce`/`toArray`/`some`/`every`/`find`) return a `Promise`; `iterator(options)` returns an async iterator.
- Lazy: a stream-returning helper consumes its source on demand (via the source's `[Symbol.asyncIterator]`), not by draining it up front.
- `{ concurrency }` (for `map`/`filter`/`forEach`/`flatMap`) runs up to N mapper invocations concurrently while preserving INPUT order of the output; `{ signal }` aborts mid-iteration. Both honored, not ignored.
- Every parity case below is a failing-test-first parity-runner case (real Node vs rifty), green before the compat ❌→✅ flip.

## Parity cases

Pinned against real Node v24 (probed):

1. `Readable.from([1,2,3]).map(x=>x*2).toArray()` → `[2,4,6]`; the returned value of `.map()` is a `Readable` (`instanceof Readable`, `readableObjectMode===true`).
2. `filter` → `Readable.from([1,2,3,4]).filter(x=>x%2===0).toArray()` → `[2,4]`.
3. `take`/`drop`: `take(2)` of `[1,2,3,4]` → `[1,2]`; `drop(2)` → `[3,4]`; `take(10)` of 3 → `[1,2,3]`; `drop(10)` of 3 → `[]`; `drop(0)` → passthrough; `take(-1)` throws `ERR_OUT_OF_RANGE` (RangeError).
4. `flatMap` → `Readable.from([1,2]).flatMap(x=>[x,x*10]).toArray()` → `[1,10,2,20]`.
5. `reduce` with init → `Readable.from([1,2,3]).reduce((a,b)=>a+b,0)` → `6`; no-init seeds from the first element → `6`; `reduce` on an EMPTY stream with no init rejects with `ERR_MISSING_ARGS`.
6. `some`/`every`/`find`: `some(x=>x===2)`→`true`; `every(x=>x>0)`→`true`; `find(x=>x>1)`→`2` (first match); `forEach` invokes the fn per chunk and resolves `undefined`.
7. Concurrency ORDER: `map(async x => { await delay((5-x)*20); return x*10 }, {concurrency:2})` over `[1,2,3,4]` → output `[10,20,30,40]` (input order) even though completion order is `[2,1,3,4]`.
8. Concurrency validation: `{concurrency:0}`, `{concurrency:-1}`, `{concurrency:'x'}` throw `ERR_OUT_OF_RANGE`; `{concurrency:1.5}` is accepted.
9. `{ signal }`: aborting the `AbortSignal` mid-iteration rejects the consumer with an `AbortError` (`code:'ABORT_ERR'`).
10. A throw inside a `map`/`filter`/etc. callback propagates (fail-fast): `map(x=>{ if(x===2) throw e })` rejects `.toArray()` with `e`.
11. `map(42)` (non-function fn) throws `ERR_INVALID_ARG_TYPE` (TypeError) synchronously.
12. `iterator({ destroyOnReturn:false })`: calling the iterator's `return()` does NOT destroy the source; the default (`destroyOnReturn:true`) DOES destroy it.

## Out of scope

- `Readable.prototype.asIndexedPairs`, `.toSorted`, or any helper NOT in the enumerated 12 — these are not part of the stabilized v22 helper set; calling an absent helper is a plain `undefined`-is-not-a-function (no method installed), not a stubbed throw.
- Helpers on `Writable`/`Duplex` write side — the helpers are Readable-side only in Node.

## Decisions

- **Placement (Node-pinned):** instance methods on `Readable.prototype` (case 1) — matches Node v17+, so `obj.map` resolves for any `Readable`/`Duplex`/`Transform` instance.
- **Concurrency semantics (Node-pinned):** up to N concurrent invocations, output re-ordered back to INPUT order (case 7) via an in-order completion window; `concurrency` default 1. Validation per case 8.
- **Signal semantics (Node-pinned):** `{signal}` abort → destroy the in-flight iteration and reject with `AbortError`/`ABORT_ERR` (case 9), reusing the `addAbortSignal` error shape already in `readable.ts`.
- **Mechanism (mine):** each helper drives the source's existing `[Symbol.asyncIterator]()`; stream-returning helpers wrap the lazy generator in `Readable.from` (objectMode). Decoupled from the WHATWG bridge — lands independently.
- REVERSIBLE — additive lazy transforms over the existing async iterator; ADR-0154 leaves the surface unclaimed (no ADR). CHANGELOG line + compat ✅ flip on completion.
