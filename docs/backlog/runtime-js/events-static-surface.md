---
area: runtime-js
status: parked
title: node:events static surface
created: 2026-06-20
why: events factory exports only EventEmitter+once; the static helpers are thin pure-JS wrappers over existing instance methods + browser AbortSignal, and node:events is NOT in the loud-stub catch-all.
user_story: As a CLI/node:test author, I want events.on() async-iter + once(signal) + the EventEmitter statics, but today the events factory silently lacks them so for-await/AbortSignal idioms throw "not a function" with no loud stub.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §3, docs/backlog/runtime-js (misc-stubs AsyncResource stance)]
code: [packages/runtime-js/src/builtins/index.ts, packages/io/src/event-emitter.ts, packages/runtime-js/src/builtins/misc-stubs.ts]
---

## Context

events factory (`builtins/index.ts:61`) exports only `EventEmitter`+`once`. NOT in `node-builtins-loud-stub` catch-all (enumerates tls/dns/readline/…, never `events`) → missing members = bare `undefined`, not loud throw. Instance methods + symbols already exist; most statics are thin wrappers.

| feature · since | real path | anchor |
|---|---|---|
| `events.on(emitter,name[,opts])` AsyncIterableIterator · v13.6 | buffered queue + Promise resolvers on `on/off`; AbortSignal ends | new |
| `events.once(...,{signal})` AbortSignal · v15 | extend `once()` to reject AbortError + detach | event-emitter.ts:211 |
| `EventEmitter.errorMonitor` symbol · v13.6 | `static errorMonitor=Symbol`; fire first in `emit('error')`, then throw-if-unhandled | new |
| captureRejections opt + static default + `nodejs.rejection` · v13.4 | `emit()`: thenable listener → `.catch`→`[captureRejectionSymbol]`/`emit('error')` | event-emitter.ts:13,18 |
| `events.getEventListeners` · v15.2 | delegate instance `listeners`; EventTarget→`[]` (matches Node) | event-emitter.ts:171 |
| `events.getMaxListeners` static · v19.9 | wrap instance `getMaxListeners` | event-emitter.ts:196 |
| `events.setMaxListeners(n,...targets)` · v15.4 | no-target→`defaultMaxListeners`; else loop | event-emitter.ts:17 |
| `events.addAbortListener`→Disposable · v20.5 | aborted→`queueMicrotask`; else `addEventListener('abort',…,{once})`; ret `{[Symbol.dispose]}` | new |
| `events.listenerCount` static (dep) · v0.9 | wrap instance `listenerCount` | event-emitter.ts:163 |
| `events.EventEmitterAsyncResource` · v17.4 | subclass wrapping `emit` in `runInAsyncScope` | misc-stubs.ts:43 |

## Options or Next

Parity-first, per-feature promotable: add failing parity test (real Node oracle) per row, then implement. Order: errorMonitor / get*/set*/listenerCount/getEventListeners (trivial wrappers) → once(signal) → addAbortListener → events.on async-iter → captureRejections (needs ctor-options without breaking the constructor-less `util.inherits`/express idiom). EventEmitterAsyncResource: sync-scope faithful only (matches AsyncResource/ALS ceiling) — document the cross-await subset, no silent stub.

## Reversibility

REVERSIBLE — recorded in this backlog item. EventEmitterAsyncResource sync-scope subset = doc-as-built, not a hidden gap; full async-context propagation stays a separate ALS ceiling.
