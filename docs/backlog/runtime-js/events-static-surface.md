---
area: runtime-js
status: draft
title: node:events static surface
created: 2026-06-20
why: events factory exports only EventEmitter+once; the static helpers are thin pure-JS wrappers over existing instance methods + browser AbortSignal, and node:events is NOT in the loud-stub catch-all.
user_story: As a CLI/node:test author, I want events.on() async-iter + once(signal) + the EventEmitter statics, but today the events factory silently lacks them so for-await/AbortSignal idioms throw "not a function" with no loud stub.
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §3, docs/backlog/runtime-js (misc-stubs AsyncResource stance)]
epic: isolate-guest-web-api
code: [packages/runtime-js/src/builtins/index.ts, packages/io/src/event-emitter.ts, packages/runtime-js/src/builtins/misc-stubs.ts, packages/runtime-js/src/builtins/events.ts]
---

## Context

events factory (`builtins/index.ts:61`) exports only `EventEmitter`+`once`+`addAbortListener`. NOT in `node-builtins-loud-stub` catch-all (enumerates tls/dns/readline/…, never `events`) → missing members = bare `undefined`, not loud throw. Instance methods + symbols already exist; most statics are thin wrappers.

| feature · since | real path | anchor |
|---|---|---|
| `events.on(emitter,name[,opts])` AsyncIterableIterator · v13.6 | buffered queue + Promise resolvers on `on/off`; AbortSignal ends | new |
| `EventEmitter.errorMonitor` symbol · v13.6 | `static errorMonitor=Symbol`; fire first in `emit('error')`, then throw-if-unhandled | new |
| captureRejections opt + static default + `nodejs.rejection` · v13.4 | `emit()`: thenable listener → `.catch`→`[captureRejectionSymbol]`/`emit('error')` | event-emitter.ts:13,18 |
| `events.getEventListeners` · v15.2 | delegate instance `listeners`; EventTarget→`[]` (matches Node) | event-emitter.ts:171 |
| `events.getMaxListeners` static · v19.9 | wrap instance `getMaxListeners` | event-emitter.ts:196 |
| `events.setMaxListeners(n,...targets)` · v15.4 | no-target→`defaultMaxListeners`; else loop | event-emitter.ts:17 |
| `events.listenerCount` static (dep) · v0.9 | wrap instance `listenerCount` | event-emitter.ts:163 |
| `events.EventEmitterAsyncResource` · v17.4 | subclass wrapping `emit` in `runInAsyncScope` | misc-stubs.ts:43 |

### Update 2026-11-26 (unit `distribution/isolate-stream-core-abort-controller`, PR #472)

Carrier of part of I3 of goal `isolate-guest-web-api` (`events.on` with `signal`, the statics) with
`runtime-js/signal-apis-as-node`; after unit 7 (manager's decision, 2026-11-26). PR #472 made
`events.once(emitter, name, options)` Node's `lib/events.js` `once` on every host (`options.signal`,
EventTarget emitters, parity `events/once-signal`) and added `EventEmitter.kMaxEventTargetListeners`/
`kMaxEventTargetListenersWarned`; the table's `once(signal)` row is done.

Measured 2026-11-26, isolate `runCode` on PR #472 vs Node v24.16.0, `Object.getOwnPropertyNames(require('events'))`:
- isolate: `EventEmitter, addAbortListener, captureRejectionSymbol, defaultMaxListeners, kMaxEventTargetListeners, kMaxEventTargetListenersWarned, length, name, once, prototype`;
- Node: `EventEmitter, EventEmitterAsyncResource, addAbortListener, captureRejectionSymbol, captureRejections, defaultMaxListeners, errorMonitor, getEventListeners, getMaxListeners, init, kMaxEventTargetListeners, kMaxEventTargetListenersWarned, length, listenerCount, name, on, once, prototype, setMaxListeners, usingDomains`.

| call (Node v24.16.0) | Node | isolate, PR #472 |
|---|---|---|
| `events.on(ee,'x',{signal})`, `abort()` while iterating | `AbortError [ABORT_ERR]`, `cause` = reason | `TypeError: events.on is not a function` |
| `events.getEventListeners(signal,'abort').length` | the count | `TypeError: … is not a function` |
| `events.setMaxListeners(1, eventTarget); getMaxListeners(eventTarget)` | `1` | `TypeError: … is not a function` |

Pinned: `packages/isolate-host/tests/abort-event-target.test.ts` (`typeof events.on`, …).

What Node's stream core (unit `runtime-js/stream-core-node-sources-unwired`, 8a, PR #471) takes from
`require('events')` — its author's answer (2026-11-26, Node v24.16.0 vendored sources):
- only `const EE = require('events')`, whole, in `internal/streams/legacy.js:9`, `readable.js:44`,
  `writable.js:45`; no destructuring; it reads none of `once`/`on`, `errorMonitor`,
  `getEventListeners`, `kCapture`, `kMaxEventTargetListeners(Warned)`, `get/setMaxListeners`
  (`addAbortListener` is its own `internal/events/abort_listener`);
- `EE.call(this, opts)` (`legacy.js:12`), `ObjectSetPrototypeOf(Stream.prototype, EE.prototype)`
  (`legacy.js:14`), `EE.captureRejectionSymbol` (`readable.js:372`, `writable.js:1129`), instance
  `listenerCount`, `prependListener`, `on/once/emit/removeListener`;
- it relies on Node's `EventEmitter` internals: constructors pre-create `this._events ??= {…}`
  (`readable.js:326`, `writable.js:394`, `duplex.js:68`); `Stream.prototype.eventNames` walks
  `this._events` (`legacy.js:98-106`: `[]` on rifty's `_listenersMap` emitter, Node
  `["data","foo"]`; pinned in 8a's `p2-emitter-store.cjs`, owner `runtime-js/events-prototype-shape`);
  the `prependListener` fallback writes `_events` (`legacy.js:118-123`), not reached (rifty has the
  method).

## Question

- (open, not decided) The surface as rifty's own code over its `EventEmitter`, or Node's
  `lib/events.js` whole through the same pinned-source pipeline (ADR-0574; the stream core's
  generator) — which also brings Node's `_events` store the stream core reads
  (`runtime-js/events-prototype-shape`).

## Options or Next

Parity-first, per-feature promotable: add failing parity test (real Node oracle) per row, then implement. Order: errorMonitor / get*/set*/listenerCount/getEventListeners (trivial wrappers) → once(signal) → events.on async-iter → captureRejections (needs ctor-options without breaking the constructor-less `util.inherits`/express idiom). EventEmitterAsyncResource: sync-scope faithful only (matches AsyncResource/ALS ceiling) — document the cross-await subset, no silent stub.

## Reversibility

REVERSIBLE — recorded in this backlog item. EventEmitterAsyncResource sync-scope subset = doc-as-built, not a hidden gap; full async-context propagation stays a separate ALS ceiling.
