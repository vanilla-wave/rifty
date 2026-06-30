---
kind: epic
status: ready
title: node:stream WHATWG bridge + modern statics
created: 2026-06-28
value: Libraries that `import 'node:stream/web'` or call Readable.toWeb / .map() / stream.compose / cork-uncork work in the browser, over Chromium's WHATWG streams + the existing EventEmitter lifecycle — no network, no new dependency.
user_story: As a dev running a lib that bridges Node↔Web streams (reads a fetch body via Readable.fromWeb, transforms with .map()/.filter(), re-exposes via Readable.toWeb) or imports `node:stream/web`, I want it to work, but today the module is unregistered and the modern statics (toWeb, predicates, async-iter helpers, compose/wrap, cork/uncork, default-HWM) throw or are absent.
items: [runtime-js/stream-writable-duplex-web-bridge, runtime-js/stream-async-iterator-helpers, runtime-js/stream-compose-wrap-duplex-from]
---

## Outcome

`@riftydev/io` streams already restore the Node contract (ADR-0034) and prove the
in-realm WHATWG bridge ONE direction (`Readable.fromWeb`, `readable.ts:897`,
parity-tested, ADR-0054/0154). The rest of the modern `node:stream` surface —
the `node:stream/web` module, `toWeb`/`fromWeb` for Writable/Duplex, the
async-iterator helpers, predicates, `compose`/`wrap`/`Duplex.from`, cork/uncork
batching, and configurable default high-water-marks — is honestly unclaimed
(ADR-0154 leaves it so; compat ❌ is doc-visibility, not a stub). Every gap is a
pure-JS adapter over Chromium's `ReadableStream`/`WritableStream` + the existing
EventEmitter/state machine — **no network, no OS, no new dependency**. Delivering
it lets real Node libraries that lean on the v16→v22 stream surface run in the
browser (the mission: real Node software, maximally faithful).

## User scenario

Done when a developer's program, unmodified, runs in the sandbox:

1. `import { ReadableStream, TransformStream } from 'node:stream/web'` resolves
   (Chromium WHATWG globals), instead of an unregistered-module throw.
2. `const r = Readable.fromWeb((await fetch(url)).body)` → `r.map(decode).filter(Boolean)`
   → `for await (const line of …)` yields transformed chunks (async-iter helpers).
3. `Readable.toWeb(fs.createReadStream(p))` hands a Node stream to a Web API as a
   real `ReadableStream` (chunks byte-exact, `cancel()` → `destroy()`).
4. `stream.compose(stageA, stageB)` wires stages into one Duplex via the existing
   `pipeline`; a `Writable` using `cork()`/`uncork()` batches through a real
   `_writev`.

Each behavior is parity-proven (real Node vs rifty) before its compat ❌ flips.

## Items

Build order (high-reach + cheap first; each independently promotable to compat ✅):

- `runtime-js/stream-writable-duplex-web-bridge` (**ready**) —
  `Writable.toWeb`/`fromWeb`, `Duplex.toWeb`/`fromWeb`. Backpressure/error-
  direction forks resolved (Node-pinned).
- `runtime-js/stream-async-iterator-helpers` (**ready**) — `map`/
  `filter`/`forEach`/`reduce`/`toArray`/`take`/`drop`/`flatMap`/`some`/`every`/
  `find`/`iterator`. Concurrency (input-order) + signal semantics resolved (Node-pinned).
- `runtime-js/stream-compose-wrap-duplex-from` (**ready**) —
  `stream.compose`, `Readable.wrap`, `Duplex.from`. Legacy-streams1 + compose
  error-propagation resolved (Node-pinned).

## Reversibility

REVERSIBLE — pure-JS adapters over Chromium WHATWG streams; ADR-0154 already
leaves the surface unclaimed, no public-API/ADR change, no network. Each feature
independently promotable; CHANGELOG per item.
