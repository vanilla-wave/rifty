# ADR 0017: `@rifty/net` scope statement and streaming rewrite deferral

Status: Accepted
Date: 2026-05

**Decision (2026-05-26):** A-022 (chunked transfer + streaming response), A-024 (raw TCP `net.Socket`), A-025 (cross-realm WebSocket) are confirmed deferred to **M12 (target = end of August 2026)**. Scope of the M12 rewrite:

- `SerializedResponse` body becomes `ReadableStream<Uint8Array>`, marked Transferable across realms via the cross-realm bridge from ADR-0011.
- Cross-realm WebSocket bridge is built on a dedicated `MessagePort` per connection rather than the current `BroadcastChannel` (which has no per-connection isolation and no backpressure).
- `net.Socket` gains a full TCP-shape surface (raw byte streaming, `_write`/`_read` honour `chunk` not HTTP frames). Where TCP semantics can't be faithfully emulated in a browser (e.g. `localAddress` selection), the TSDoc declares the limitation as final.

M12 starts only after M11 ships ADR-0011's worker-as-process — the bridge is the load-bearing primitive.

## Context

`@rifty/net` today provides `node:http` over a buffered `Response`-shape RPC, with the response body fully materialised before delivery. `node:net.Socket` is implemented in terms of the HTTP layer (it carries HTTP-shape frames, not raw bytes). `node:ws` works only when client and server are in the same realm. Three REVIEW_ACTIONS entries — A-022 (chunked transfer encoding), A-024 (raw TCP via `net.Socket`), A-025 (cross-realm WebSocket) — each describe one symptom of the same buffered-RPC constraint.

The clean fix for all three is a streaming `SerializedResponse` contract where the response body is a `ReadableStream<Uint8Array>` Transferable across realms, plus the cross-realm bridge that ADR 0011 introduces. Ad-hoc per-method fixes would each require a cross-cutting refactor of the same surface.

## Decision

Document `@rifty/net`'s current scope explicitly and defer the streaming rewrite to a single milestone that addresses all three gaps together.

- Current scope (documented in `packages/net/README.md` and the public TSDoc):
  - `node:http` carries fully-buffered responses. Long-poll and SSE workloads will not stream.
  - `node:net.Socket` is HTTP-shape only; it is not a general raw TCP socket.
  - `node:ws` operates only when the client and server live in the same realm.
- Future state (deferred to M12, after ADR 0011's worker-as-process lands in M11):
  - `SerializedResponse` becomes `{ status, headers, body: ReadableStream<Uint8Array> }`, transferred across realms via the cross-realm bridge.
  - `net.Socket` either gains raw byte streaming on top of the same primitive, or its TSDoc declares the HTTP-shape limitation as final.
  - `node:ws` server-side wires through the cross-realm bridge to allow iframe and worker clients to connect.

## Consequences

- The three gaps unblock together rather than in three separate refactor passes.
- Until M12, real Node packages that rely on chunked transfer encoding, raw TCP, or cross-realm WS fail loudly (or behave per the documented scope).
- Negative: M11's worker-as-process model is on the critical path. ADR 0017 does not start until ADR 0011 ships.
- Negative: scope documentation is itself a maintenance surface; the README must be updated each time the scope shifts.
- Follow-up: M12.

## Acceptance criteria for the deferred implementation

- [ ] Long-polling integration test passes: a request hangs for > 1 s, then drains chunked.
- [ ] An iframe-loaded HMR client connects to the dev-server `WebSocketServer` via the cross-realm bridge and receives an `update` message.
- [ ] `net.Socket` either supports raw byte streaming end-to-end (preferred) or its TSDoc declares "HTTP-shape only" and tests assert the documented behavior.
- [ ] `SerializedResponse` carries a `ReadableStream` body across the `postMessage` boundary in the bridge.
