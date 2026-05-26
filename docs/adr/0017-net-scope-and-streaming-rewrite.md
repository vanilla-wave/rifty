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
- [x] An iframe-loaded HMR client connects to the dev-server `WebSocketServer` via the cross-realm bridge and receives an `update` message. — see Addendum 2026-05-26.
- [ ] `net.Socket` either supports raw byte streaming end-to-end (preferred) or its TSDoc declares "HTTP-shape only" and tests assert the documented behavior.
- [ ] `SerializedResponse` carries a `ReadableStream` body across the `postMessage` boundary in the bridge.

---

## Addendum 2026-05-26: phase 1 acceptance closed

The "iframe-loaded HMR client connects via the cross-realm bridge" acceptance criterion is **satisfied** in M10 — closed early per D-D in the 2026-05-26 architecture review. The wiring shipped ahead of the M12 streaming rewrite specifically so the M11 A-026 migration (Vite-in-Worker) becomes a realm swap, not a fresh routing rewrite.

### What landed

- `apps/playground/src/adapters/hmr-bridge.ts` — new adapter. Exports:
  - `setupHmrBridge({port}): HmrBridgeHandle` — instantiates a page-realm `BridgedWebSocketServer` on `ws://preview.local:<port>/__hmr` and returns `{ url, broadcast, close }`.
  - `hmrClientScript(port)` — vanilla-JS string injected into the preview iframe; mirrors the bridge wire protocol (`open` → `open-ack` → `msg` → `close`) over `BroadcastChannel` directly so the client doesn't need to import `@rifty/net`.
  - `createHmrBridgeVitePlugin({port})` — minimal Vite plugin with `transformIndexHtml` that idempotently injects the client script before `</body>`.
- `apps/playground/src/adapters/realVite.ts` — calls `setupHmrBridge({port})` before `vite.createServer(...)` so the plugin sees a stable port. Hooks `server.watcher.on('change', file)` to broadcast `{type: 'update', path: file}` through the bridge. Vite's native HMR machinery remains off (`server.hmr: false`) — Vite still does module-graph invalidation; the bridge delivers the iframe notification.
- `packages/net/src/ws/bridge.ts` — `channelNameFor(url)` is now part of the public API (re-exported through `index.ts` / `ws.ts`). Inlined clients need this so server and client agree on the `BroadcastChannel` name without depending on the package's full surface. Other shapes (`BridgedWebSocket`, `BridgedWebSocketServer`, `BridgedWebSocketConnection`, `createCrossRealmBridge`, `WsMessage`, `CrossRealmBridge`) were already public; only `channelNameFor` graduated.

### What is intentionally **not** in scope

- The M12 deferral for A-022 / A-024 / A-025 remains. The acceptance criteria for chunked transfer, raw TCP, and `SerializedResponse` streaming are unaffected by this addendum. The bridge transport is still `BroadcastChannel` (no per-connection isolation, no backpressure) — M12 swaps it for dedicated `MessagePort` per the original decision.
- `BridgedWebSocket` internals are untouched — the wiring closes the acceptance with the API that existed in the package, no refactor of buffering / backpressure / event-emitter shape.
- Vite's full HMR module-graph protocol (ESM HMR `update` payloads, `accept`/`dispose`) is out of scope. The bridge delivers a naive `{type:'update'}` payload, the iframe client reloads — sufficient for M10 acceptance and M11 A-026 forward compat. Real HMR semantics land alongside the Vite-in-Worker migration.

### Tests

- `apps/playground/src/adapters/hmr-bridge.test.ts` — 9 unit tests covering the round-trip (client open / broadcast), the channel-name contract (server URL ↔ inlined client script), and the Vite plugin idempotence.
- `tests/e2e/m10-hmr.spec.ts` — Playwright spec that drives the full Real Vite flow → file edit → iframe reload. Gated by `RIFTY_E2E_HMR=1` because Real Vite mode incurs a ~20 s install on cold cache; the unit test covers the wiring contract for CI.
