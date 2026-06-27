---
area: runtime-js
status: draft
title: worker_threads kernel path — full structuredClone workerData (JSON-only today)
created: 2026-06-21
why: the kernel-backed Worker ships workerData as JSON (RIFTY_WORKER_DATA_JSON env), so structuredClone-valid values Node accepts (Date, Map, Set, TypedArray, ArrayBuffer, BigInt, -0, NaN, Infinity) loud-throw NotImplementedError instead of round-tripping
user_story: As a dev passing `workerData: { when: new Date(), seen: new Map() }` to a kernel-backed `worker_threads.Worker`, I want it inside the worker like Node (structuredClone) — but today the kernel path encodes workerData as JSON, so anything JSON can't faithfully carry is loud-rejected with NotImplementedError('worker_threads.workerData.structuredClone').
sources: [packages/runtime-js/src/builtins/worker_threads.ts]
code: [packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

The kernel path serializes `workerData` with `JSON.stringify` into the
`RIFTY_WORKER_DATA_JSON` spawn-env key and `JSON.parse`s it in the child
(`encodeWorkerData`/`decodeWorkerData`). `assertJsonCloneSafeWorkerData` walks the
value FIRST and loud-throws `NotImplementedError('worker_threads.workerData.structuredClone')`
for anything JSON can't carry faithfully — non-plain objects (Date/Map/Set/RegExp/
class instances), TypedArray/ArrayBuffer, BigInt, functions, `undefined` holes,
cycles, and the finite-number exclusions `NaN`/`Infinity`/`-0` (the latter three
because `JSON.stringify` would silently reshape them — `-0`→`0`, `NaN`/`Infinity`→
`null`). Node's `workerData` uses structuredClone, which accepts all of these.

So the gap is an HONEST, loud divergence (NotImplementedError, never silent — the
`-0` silent hole was closed in this same cut), but it is a real parity gap: valid
Node `workerData` throws in rifty. The same-realm fallback has no such limit (it
passes `workerData` by reference in-realm), so this is kernel-path-only.

## Options or Next

Carry `workerData` over the kernel channel with a structured-clone-faithful codec
instead of JSON — either a real `structuredClone` over the fork-IPC frame (not the
spawn-env string, which is JSON-shaped by construction) or a typed
serialize/deserialize covering the structuredClone-supported set. Decide the
boundary deliberately (match structuredClone, or a documented subset with the rest
still loud-throwing). Failing test first (COI/SAB kernel path): `workerData` with a
`Date`/`Map`/`TypedArray` round-trips equal inside the worker.

Until then the loud throw stays (honest gap, not a silent reshape), marked
`TODO(backlog: runtime-js/worker-threads-kernel-workerdata-structured-clone)` at the
guard.

## Reversibility

REVERSIBLE — widening the workerData codec is additive (more inputs accepted, none
break); the env-string vs IPC-frame transport choice is internal. No public
worker_threads API change.
