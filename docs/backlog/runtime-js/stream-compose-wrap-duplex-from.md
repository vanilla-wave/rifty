---
area: runtime-js
status: ready
title: stream.compose + Readable.wrap + Duplex.from
created: 2026-06-28
why: stream.compose, Readable.wrap (legacy streams1 adapter), and Duplex.from are absent; pipeline.ts already exists to wire compose's stages
user_story: As a dev running a lib that does `stream.compose(a, b, c)` to build a Duplex, `Readable.wrap(oldStream)` to adapt a streams1 source, or `Duplex.from(iterableOrFn)`, I want them to work, but today they are absent.
epic: whatwg-stream-bridge
sources: [ADR-0034, docs/research/node-parity-gaps-unbacklogged-2026-06-20.md]
code: [packages/io/src/streams/index.ts, packages/io/src/streams/duplex.ts, packages/io/src/streams/pipeline.ts]
---

## Context

`stream.compose`, `Readable.prototype.wrap`, and `Duplex.from` are absent. `pipeline.ts` (full pipeline + destroy-on-error) exists and is the wiring `compose` reuses; `Readable.from` exists and is `Duplex.from`'s read-side basis; the async-iterator base + helpers (sibling item) give `Duplex.from(fn)` its source iteration.

## Acceptance

- `stream.compose(...stages)` returns a `Duplex` (`instanceof Duplex`) wiring write→stage[0], read←stage[n-1]; an error in ANY stage destroys EVERY stage and surfaces on the composed duplex.
- `Readable.prototype.wrap(legacy)` returns `this` (a `Readable`) fed from a legacy streams1 `'data'`/`'end'` source.
- `Duplex.from(src)` returns a `Duplex` for each accepted source shape; an unsupported shape throws `ERR_INVALID_ARG_TYPE` (no silent coercion).
- Every parity case below is a failing-test-first parity-runner case (real Node vs rifty), green before the compat ❌→✅ flip.

## Parity cases

Pinned against real Node v24 (probed):

1. `compose(upper, bracket)` of two `Transform`s, `c.end('hi')` then drain → `['[HI]']` (write feeds stage 0, read drains stage n-1); `c instanceof Duplex`.
2. `compose(asyncGenFn)` — a stage that is an async-generator function `async function*(src){…}` — constructs an `instanceof Duplex` (mixed stage kinds accepted).
3. `compose` error propagation: a stage whose `transform` calls back with an error → the composed duplex emits `'error'` with that error AND every stage is destroyed (`a.destroyed && b.destroyed`).
4. `Duplex.from(async function*(src){ for await (c of src) yield UPPER(c) })`: writing `'ab'`/`'cd'` to the duplex yields `'AB'`/`'CD'` on its readable side (write→source, read←yields).
5. `Duplex.from(['x','y'])` (iterable) → its readable side yields `['x','y']`.
6. `Duplex.from({readable, writable})` → an `instanceof Duplex` over the pair.
7. `Duplex.from(42)` (unsupported shape) throws `ERR_INVALID_ARG_TYPE`.
8. `new Readable().wrap(legacy)`: a legacy `EventEmitter` with `pause`/`resume` that emits `'data','L1'`/`'data','L2'`/`'end'` → the wrapping `Readable` emits `['L1','L2']`; `wrap` returns the `Readable`.

## Out of scope

- The exact internal constructor NAME of the composed/`from` result (`'Duplexify'` in Node) — rifty returns a `Duplex` instance (`instanceof Duplex` holds, which is the contract); the private class name is not replicated (recorded below).
- `compose` of a WHATWG `ReadableStream`/`WritableStream` stage — the bridge adapters (sibling item) convert those first; a raw web-stream stage passed directly to `compose` throws `ERR_INVALID_ARG_TYPE` rather than being silently accepted.
- Legacy streams1 `pause()`/`resume()` flow-control fidelity BEYOND `'data'`/`'end'` subscription (e.g. honoring a legacy source's own internal buffering quirks) — `wrap` subscribes and re-pushes with rifty's backpressure; it does not reproduce a specific streams1 implementation's pause internals.

## Decisions

- **`compose` wiring (mine):** reuse the shipped `pipeline` to chain stages and propagate destroy-on-error (case 3); the composed `Duplex`'s write side feeds stage 0, its read side mirrors stage n-1. Function stages are normalized to a `Transform`/`Duplex` (via `Duplex.from`) before wiring.
- **Accepted source shapes for `Duplex.from` (Node-pinned):** async-generator function, sync/async iterable, `{readable, writable}` pair (cases 4–6); everything else → `ERR_INVALID_ARG_TYPE` (case 7).
- **Return type (mine, parity-pinned on behavior not name):** a `Duplex` instance — `instanceof Duplex` matches Node for all forms; the internal `'Duplexify'` class name is NOT replicated (out of scope above), because no faithful contract depends on the private name.
- **`wrap` (Node-pinned):** subscribe legacy `'data'`/`'end'`, `push()` each chunk honoring rifty backpressure, return `this` (case 8).
- REVERSIBLE — additive, reuses the shipped `pipeline`/`Readable.from`/async-iter base; ADR-0154 leaves the surface unclaimed (no ADR). CHANGELOG line + compat ✅ flip on completion.
