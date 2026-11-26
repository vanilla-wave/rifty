---
area: runtime-js
status: draft
title: node:events static surface
created: 2026-06-20
why: events factory exports only EventEmitter+once; the static helpers are thin pure-JS wrappers over existing instance methods + browser AbortSignal, and node:events is NOT in the loud-stub catch-all.
user_story: As a CLI/node:test author, I want events.on() async-iter + once(signal) + the EventEmitter statics, but today the events factory silently lacks them so for-await/AbortSignal idioms throw "not a function" with no loud stub.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §3, docs/backlog/runtime-js (misc-stubs AsyncResource stance)]
code: [packages/runtime-js/src/builtins/index.ts, packages/io/src/event-emitter.ts, packages/runtime-js/src/builtins/misc-stubs.ts]
---

## Context

events factory (`builtins/index.ts:61`) exports only `EventEmitter`+`once`+`addAbortListener`. NOT in `node-builtins-loud-stub` catch-all (enumerates tls/dns/readline/…, never `events`) → missing members = bare `undefined`, not loud throw. Instance methods + symbols already exist; most statics are thin wrappers.

| feature · since | real path | anchor |
|---|---|---|
| `events.on(emitter,name[,opts])` AsyncIterableIterator · v13.6 | buffered queue + Promise resolvers on `on/off`; AbortSignal ends | new |
| `events.once(...,{signal})` AbortSignal · v15 | extend `once()` to reject AbortError + detach | event-emitter.ts:211 |
| `EventEmitter.errorMonitor` symbol · v13.6 | `static errorMonitor=Symbol`; fire first in `emit('error')`, then throw-if-unhandled | new |
| captureRejections opt + static default + `nodejs.rejection` · v13.4 | `emit()`: thenable listener → `.catch`→`[captureRejectionSymbol]`/`emit('error')` | event-emitter.ts:13,18 |
| `events.getEventListeners` · v15.2 | delegate instance `listeners`; EventTarget→`[]` (matches Node) | event-emitter.ts:171 |
| `events.getMaxListeners` static · v19.9 | wrap instance `getMaxListeners` | event-emitter.ts:196 |
| `events.setMaxListeners(n,...targets)` · v15.4 | no-target→`defaultMaxListeners`; else loop | event-emitter.ts:17 |
| `events.listenerCount` static (dep) · v0.9 | wrap instance `listenerCount` | event-emitter.ts:163 |
| `events.EventEmitterAsyncResource` · v17.4 | subclass wrapping `emit` in `runInAsyncScope` | misc-stubs.ts:43 |

## Stream core's dependency on `EventEmitter` (PR #471, 2026-11-26)

Facts for the user's question «take Node's `lib/events.js` whole» (asked; no choice here). Node
v24.16.0's stream core (8a, `packages/io/src/streams/node/generated/`) imports only
`const EE = require('events')` (`internal/streams/legacy.js:9`, `readable.js:44`, `writable.js:45`).
Measured by the stream-core differential (`tests/integration/node-streams-differential.test.ts`:
live Node / the core on Node's bindings / the core on rifty's, in-process, one rifty `process`);
each differing row is pinned there with this item as owner. Neighbours, same root, linked here:
`runtime-js/events-prototype-shape` (the `_events` store), `runtime-js/events-listener-count-listener-arg`,
`runtime-js/events-once-wrapper-bind`.

| core dependency point | differential row | rifty today |
|---|---|---|
| `EE.call(this, opts)`, `Stream.prototype` → `EE.prototype` (`legacy.js:12,14`) | `e4` chain | equal |
| `this._events ??= { … }` pre-shaped by the constructors (`readable.js:326`, `writable.js:394`, `duplex.js:68`) | `e4` store, `p2` ×3 | the store is never used: `_eventsCount` `undefined` |
| `Stream.prototype.eventNames` walks `this._events` (`legacy.js:98`) | `p2` ×3, `e4` legacy | `[]` on every core stream (Node `["data","foo"]`); `new Stream().eventNames()` throws `Reflect.ownKeys called on non-object` (Node `[]`) |
| `listenerCount(ev)` (`destroy.js:261`, `legacy.js:63`, `readable.js:1029,1143,1180,1208`) | matrices | equal |
| `listenerCount(ev, fn)` (Node v24: counts `fn` only) | `e4` | `2` (Node `1`) |
| `prependListener`, and its `_events` fallback (`legacy.js:111-123`) | `e4` pipe prepends | equal; the fallback is not reached (rifty has the method) |
| unhandled `'error'`: Node's `emit` throws with `Emitted 'error' event on Readable instance at:`; a non-Error → `ERR_UNHANDLED_ERROR` `Unhandled error. ('str')` | `e1`, `e2` stderr | `Error: boom` without the `Emitted` line; non-Error `Error: Unhandled 'error' event: str` |
| `EE.errorMonitor` | `e4` | the monitor is not called |
| `captureRejections: true` + `EE.captureRejectionSymbol` (the core defines `[captureRejectionSymbol]` on both prototypes) | `e4` | an async listener's rejection reaches `unhandledRejection`, not `'error'` |
| `MaxListenersExceededWarning` (11 pipes into one source) | `e3` | `console.warn` text without `[PassThrough]`/`MaxListeners is 10`, no `'warning'` event; `setMaxListeners(-1)` does not throw (Node `ERR_OUT_OF_RANGE`) |
| statics `EE.on`, `getEventListeners` | `e4`, `m10` ×2 | `undefined`; `m10`'s listener counts read `n/a` |
| `once` wraps through the live `Function.prototype.bind` | `p1` bind | rifty completes where Node throws (`events-once-wrapper-bind`) |
| `emit`'s live `slice`, `Map.prototype.get/set/delete` | `p1` | `runtime-js/post-guest-paths-use-replaceable-intrinsics` |

Size of the alternative: `lib/events.js` 36 113 B raw / 9 111 B gzip; with its two internal files
not vendored by 8a (`internal/fixed_queue.js` 4 486 / 1 193, `internal/events/symbols.js` 147 /
133) 10 153 B gzip of source (minified bundle bytes not measured). Beyond 8a's slices it reads
`internal/errors` `ERR_UNHANDLED_ERROR`, `genericNodeError`, `kEnhanceStackBeforeInspector`;
`internal/util` `spliceOne`; `internal/util/inspect` `identicalSequenceRange`; `validateNumber`;
`internal/event_target` `isEventTarget`/`kEvents` (a binding); `async_hooks` (for
`EventEmitterAsyncResource`, lazily); `internal/events/abort_listener` is already vendored.

## Options or Next

Parity-first, per-feature promotable: add failing parity test (real Node oracle) per row, then implement. Order: errorMonitor / get*/set*/listenerCount/getEventListeners (trivial wrappers) → once(signal) → events.on async-iter → captureRejections (needs ctor-options without breaking the constructor-less `util.inherits`/express idiom). EventEmitterAsyncResource: sync-scope faithful only (matches AsyncResource/ALS ceiling) — document the cross-await subset, no silent stub.

## Reversibility

REVERSIBLE — recorded in this backlog item. EventEmitterAsyncResource sync-scope subset = doc-as-built, not a hidden gap; full async-context propagation stays a separate ALS ceiling.
