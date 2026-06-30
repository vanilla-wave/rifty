---
area: runtime-js
status: ready
title: Writable.toWeb/fromWeb + Duplex.toWeb/fromWeb
created: 2026-06-28
why: the write/duplex half of the Node↔WHATWG bridge is absent; Readable.fromWeb/toWeb prove the read half, these complete it (pure-JS over Chromium WritableStream)
user_story: As a dev running a lib that does `Writable.fromWeb(webWritable)` to sink into a Web stream or `Duplex.toWeb(d)` to expose `{readable, writable}` to a Web API, I want them to work, but today only the Readable side bridges.
epic: whatwg-stream-bridge
sources: [ADR-0154, docs/research/node-parity-gaps-unbacklogged-2026-06-20.md]
code: [packages/io/src/streams/writable.ts, packages/io/src/streams/duplex.ts]
---

## Context

`Writable.toWeb`/`fromWeb` and `Duplex.toWeb`/`fromWeb` are absent. `Readable.fromWeb`/`toWeb` (the read half, `readable.ts:918`/`983`) are the pattern. All pure-JS over Chromium `WritableStream`/`ReadableStream`. The duplex statics compose the four single-side adapters.

## Acceptance

- `Writable.toWeb(w)` returns a real `WritableStream`; `Writable.fromWeb(ws)` returns a Node `Writable`; `Duplex.toWeb(d)` returns `{ readable, writable }` (a `ReadableStream` + `WritableStream`); `Duplex.fromWeb({readable, writable}, opts?)` returns a Node `Duplex`. All four registered as `node:stream` statics + exported from `@riftydev/io`.
- Backpressure is REAL, not buffer-the-whole-stream: `Writable.toWeb(w)`'s writer `write()` does not resolve past the Node writable's `'drain'`/write-callback (verified against Node, below). No adapter accumulates the entire stream in memory.
- Errors propagate in BOTH directions across every adapter (web→node and node→web), each carrying the originating error (not a generic wrapper).
- Every parity case below is a failing-test-first parity-runner case (real Node vs rifty), green before the compat ❌→✅ flip.

## Parity cases

Pinned against real Node v24 (probed):

1. `Writable.fromWeb(ws)`: `w.write('a'); w.write('b'); w.end('c')` → the WHATWG sink observes `write('a'),write('b'),write('c'),close()` in order; `'finish'` fires on the Node side.
2. `Writable.fromWeb` error — node→web: `w.destroy(err)` → the WHATWG sink's `abort(reason)` runs with `reason===err`.
3. `Writable.fromWeb` error — web→node: the WHATWG `WritableStreamDefaultController.error(err)` → the Node `w` emits `'error'` with that error and `w.destroyed===true`.
4. `Writable.toWeb(w)` basic: `writer.write(chunk)` drives the Node `w`'s `_write`; `writer.close()` → `_final`/`'finish'`.
5. `Writable.toWeb(w)` backpressure: with `highWaterMark:1` and a `_write` that withholds its callback, the writer's `write()` promise for the NEXT chunk stays pending and `_write` is NOT called for it until the withheld callback fires (serialized, drain-gated).
6. `Writable.toWeb(w)` error — node→web: `w.destroy(err)` → `writer.closed` rejects with `err`.
7. `Writable.toWeb(w)` error — web→node: `writer.abort(reason)` → `w.destroy(reason)` (`w.destroyed===true`, `'error'` carries `reason`).
8. `Duplex.toWeb(d)` returns an object with both `readable` (a `ReadableStream`) and `writable` (a `WritableStream`); the readable side streams `d`'s pushed chunks and the writable side drives `d`'s `_write`.
9. `Duplex.fromWeb({readable, writable})` default `allowHalfOpen===false`; `Duplex.fromWeb(pair, {allowHalfOpen:true})` → `allowHalfOpen===true`. (Note: a bare `new Duplex()` defaults `allowHalfOpen:true` — `fromWeb`'s default is deliberately the opposite, matching Node.)
10. `Writable.fromWeb`/`Duplex.fromWeb` reject a non-WHATWG argument with a `TypeError` synchronously (mirrors `Readable.fromWeb`).

## Out of scope

- `objectMode` mapping across the bridge beyond what Node does by default (Node's web adapters are byte/any-value; no rifty-specific objectMode coercion). A caller relying on a non-Node objectMode contract is unaffected — the adapters match Node's plain pass-through.
- Cross-realm transfer of the returned WHATWG streams (`postMessage` transfer of a `ReadableStream`/`WritableStream`) — orthogonal to this adapter surface; unchanged from today.

## Decisions

- **Backpressure mechanism (mine, parity-pinned):** `Writable.toWeb` maps each WHATWG `write(chunk)` to `w.write(chunk)` and, when that returns `false`, awaits the next `'drain'` before resolving — reproducing case 5 exactly. No `desiredSize`-polling; the Node writable's existing drain machinery IS the backpressure source.
- **Error direction (mine, parity-pinned):** every adapter wires both directions (cases 2/3/6/7) — node `destroy(err)`↔web `controller.error(err)`/`abort(reason)` — carrying the same error object/reason. Symmetric, no generic re-wrap.
- **`allowHalfOpen` (Node-pinned):** `Duplex.fromWeb` defaults `false` (case 9), opposite the bare-`Duplex` default; honored from the options bag.
- **Reuse:** `Duplex.toWeb = { readable: Readable.toWeb(d), writable: Writable.toWeb(d) }`; `Duplex.fromWeb` composes `Readable.fromWeb` + `Writable.fromWeb` over the embedded sides.
- REVERSIBLE — additive pure-JS adapters over host WHATWG streams; ADR-0154 leaves the surface unclaimed (no ADR). CHANGELOG line + compat ✅ flip on completion.
