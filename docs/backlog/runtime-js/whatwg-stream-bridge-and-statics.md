---
area: runtime-js
status: parked
title: node:stream WHATWG bridge + modern statics
created: 2026-06-20
why: node:stream/web + Node<->WHATWG bridge + modern static surface honestly unclaimed (ADR-0154); all pure-JS adapters over Chromium ReadableStream/WritableStream + existing EventEmitter lifecycle.
user_story: As a dev running a lib that `import {…} from 'node:stream/web'` or calls Readable.toWeb / .map() / stream.compose, I want them to work, but today the module is unregistered and the statics throw/are absent.
sources: [docs/adr/net/0154-*, docs/adr/runtime-js/0034-*, docs/adr/runtime-js/0035-*, docs/adr/runtime-js/0069-*, docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §2, docs/public/compat/streams.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts, packages/io/src/streams/index.ts, packages/runtime-js/src/builtins/stream.ts, packages/runtime-js/src/builtins/index.ts]
---

## Context

`Readable.fromWeb` (readable.ts:897) proves the in-realm bridge; rest unclaimed. compat ❌ = doc-visibility, not impl. All in-realm (no net/OS).

| Feature | Node since | Real path | Anchor |
|---|---|---|---|
| `node:stream/web` module | v16.5 | re-export Chromium WHATWG globals (Readable/Writable/Transform/readers/Text*Stream); throw on truly-missing (BYOB) | builtins/index.ts:83-88 (unregistered) |
| Readable.toWeb | v17 | wrap data/end/error in ReadableStream source; pull + cancel→destroy | readable.ts |
| Writable.toWeb/fromWeb | v17 | WritableStream sink awaits drain; fromWeb pumps _write→writer | writable.ts |
| Duplex.toWeb/fromWeb | v17 | compose R/W web adapters {readable,writable} | duplex.ts |
| Readable async-iter helpers (map/filter/forEach/reduce/toArray/take/drop/flatMap/some/every/find/iterator) | v17→v22 | lazy transforms over `[Symbol.asyncIterator]` w/ concurrency+signal | readable.ts:682 |
| stream.addAbortSignal | v15.4 | AbortSignal→destroy(AbortError); half-built in fromWeb | index.ts |
| isReadable/isWritable/isErrored/isDisturbed | v16.14/v17.3 | predicates over _readable/_writableState; disturbed needs explicit bit (no approximate) | index.ts |
| Readable.wrap | v0.9 | subscribe legacy stream, push() honoring pause/resume | readable.ts |
| stream.compose | v16.9 | Duplex wiring stages via existing pipeline.ts | index.ts |
| Duplex.from | v16.8 | reuse Readable.from read side + passthrough write; throw on unknown shapes | duplex.ts |
| get/setDefaultHighWaterMark | v19.9 | 2 module vars (16384B/16 obj) read by ctors (hardcode `?? 16*1024` today) | index.ts |
| cork/uncork batching | v0.11 | corked counter defers drain; uncork flushes via `_writev` | writable.ts |

NOTE: the lying `writev?` type-only option (writable.ts, used nowhere) was already REMOVED (silent-node-divergences, closed). When cork/uncork batching lands here, re-add `writev?` to `WritableOptions` and wire `_writev` for real — cork/uncork's batching needs `_writev` working, so they land together.

## Options or Next

Parity-first, per-feature promotable. Per item: write failing parity test (real Node vs ours) → implement → flip compat ❌. Order: stream/web module + Readable.toWeb (highest lib reach) → predicates/statics (S, cheap) → Writable/Duplex toWeb/fromWeb → async-iter helpers (L) → compose/wrap/Duplex.from. Register `node:stream/web` in builtins/index.ts alongside stream/promises/consumers.

## Reversibility

REVERSIBLE — recorded in this backlog item. No public-API/ADR change (ADR-0154 already leaves surface unclaimed; no network). Each feature independently promotable to `active`.
