---
area: runtime-js
status: draft
title: stream.compose + Readable.wrap + Duplex.from
created: 2026-06-28
why: stream.compose, Readable.wrap (legacy streams1 adapter), and Duplex.from are absent; pipeline.ts already exists to wire compose's stages
user_story: As a dev running a lib that does `stream.compose(a, b, c)` to build a Duplex, `Readable.wrap(oldStream)` to adapt a streams1 source, or `Duplex.from(iterableOrFn)`, I want them to work, but today they are absent.
epic: whatwg-stream-bridge
sources: [ADR-0034, docs/research/node-parity-gaps-unbacklogged-2026-06-20.md]
code: [packages/io/src/streams/index.ts, packages/io/src/streams/duplex.ts, packages/io/src/streams/pipeline.ts]
---

## Context

`stream.compose`, `Readable.wrap`, and `Duplex.from` are absent. `pipeline.ts` (full pipeline + destroy-on-error) exists and is the wiring `compose` reuses; `Readable.from` exists and is `Duplex.from`'s read-side basis.

## Clear path (resolve at refine)

- `stream.compose(...stages)` → a `Duplex` whose write side feeds stage[0] and read side drains stage[n-1], wired via the existing `pipeline` (error from any stage destroys the whole chain).
- `Readable.wrap(oldStream)` → subscribe a legacy (streams1) `'data'`/`'end'` source, `push()` honoring pause/resume backpressure.
- `Duplex.from(src)` → reuse `Readable.from` for the read side + a passthrough write side; throw loudly on unknown shapes (no silent coercion).
- **Forks to settle:** `compose` accepting mixed stage kinds (Duplex / Transform / async-generator / web stream) and the exact error/finish propagation; `wrap`'s coverage of legacy `pause()`/`resume()`/`destroy()` edge cases; `Duplex.from`'s accepted source shapes (iterable, async-iterable, function, `{readable,writable}`) and the loud-throw set for the rest. Each becomes a parity case before flip.

## Reversibility

REVERSIBLE — additive, reuses the shipped pipeline/Readable.from; no ADR (ADR-0154 leaves the surface unclaimed); CHANGELOG line + compat ✅ flips on completion.
