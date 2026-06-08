# ADR 0017: `@riftydev/net` scope statement and streaming rewrite deferral

Status: Accepted
Date: 2026-05

**Decision (2026-05-26):** A-022 (chunked transfer + streaming response), A-024 (raw TCP `net.Socket`), A-025 (cross-realm WebSocket) are deferred to **M12 (target = end of August 2026)**. M12 rewrite scope:

- `SerializedResponse` body becomes `ReadableStream<Uint8Array>`, Transferable across realms via the cross-realm bridge from ADR-0011.
- Cross-realm WebSocket bridge uses a dedicated `MessagePort` per connection instead of the current `BroadcastChannel` (no per-connection isolation, no backpressure).
- **New for M12 (2026-05-27):** the cross-realm preview-port bridge from **ADR-0043** (`@riftydev/net.bridgeCrossRealmPreview` / `serveCrossRealmPreview`) shares the same `BroadcastChannel` carrier and the same buffered, no-backpressure limit. M12 swaps both bridges to dedicated `MessagePort`s in one pass; SSE / long-poll over a Real Vite preview hangs until then.
- `net.Socket` gains a full TCP-shape surface (raw byte streaming; `_write`/`_read` honour `chunk`, not HTTP frames). Where TCP semantics can't be faithfully emulated in a browser (e.g. `localAddress` selection), the TSDoc declares the limitation final.

M12 starts only after M11 ships ADR-0011's worker-as-process — the bridge is the load-bearing primitive.

> TL;DR: `@riftydev/net`'s chunked/SSE, raw-TCP `net.Socket`, and cross-realm WS gaps defer to one M12 rewrite: `ReadableStream` body + per-conn `MessagePort` over today's `BroadcastChannel`

## Context

`@riftydev/net` today provides `node:http` over a buffered `Response`-shape RPC with the body fully materialised before delivery. `node:net.Socket` is built on the HTTP layer (carries HTTP-shape frames, not raw bytes). `node:ws` works only same-realm. Three REVIEW_ACTIONS entries — A-022 (chunked transfer), A-024 (raw TCP via `net.Socket`), A-025 (cross-realm WebSocket) — are symptoms of the same buffered-RPC constraint.

The clean fix for all three is a streaming `SerializedResponse` (body = `ReadableStream<Uint8Array>` Transferable across realms) plus ADR-0011's cross-realm bridge. Ad-hoc per-method fixes would each re-refactor the same surface.

## Decision

Document `@riftydev/net`'s current scope explicitly; defer the streaming rewrite to one milestone addressing all three gaps together.

- Current scope (in `packages/net/README.md` + public TSDoc):
  - `node:http` carries fully-buffered responses; long-poll and SSE will not stream.
  - `node:net.Socket` is HTTP-shape only, not a general raw TCP socket.
  - `node:ws` works only when client and server share a realm.
- Future state (M12, after ADR-0011's worker-as-process lands in M11):
  - `SerializedResponse` becomes `{ status, headers, body: ReadableStream<Uint8Array> }`, transferred across realms via the bridge.
  - `net.Socket` gains raw byte streaming on the same primitive, or its TSDoc declares the HTTP-shape limitation final.
  - `node:ws` server-side wires through the bridge so iframe/worker clients can connect.

## Consequences

- The three gaps unblock together rather than in three refactor passes.
- Until M12, real packages relying on chunked transfer, raw TCP, or cross-realm WS fail loudly (or behave per documented scope).
- Negative: M11's worker-as-process is on the critical path; ADR-0017 does not start until ADR-0011 ships.
- Negative: scope documentation is a maintenance surface; README updates on each scope shift.
- Follow-up: M12.

## Acceptance criteria for the deferred implementation

- [ ] Long-polling integration test passes: a request hangs > 1 s, then drains chunked.
- [x] An iframe-loaded HMR client connects to the dev-server `WebSocketServer` via the cross-realm bridge and receives an `update` message. — see Addendum 2026-05-26.
- [ ] `net.Socket` either supports raw byte streaming end-to-end (preferred) or its TSDoc declares "HTTP-shape only" and tests assert it.
- [ ] `SerializedResponse` carries a `ReadableStream` body across the `postMessage` boundary in the bridge.

---

## Addendum 2026-05-26: phase 1 acceptance closed

The "iframe-loaded HMR client connects via the cross-realm bridge" criterion is **satisfied** in M10 — closed early per D-D in the 2026-05-26 architecture review. Wiring shipped ahead of the M12 streaming rewrite so the M11 A-026 migration (Vite-in-Worker) becomes a realm swap, not a fresh routing rewrite.

### What landed

- `apps/playground/src/adapters/hmr-bridge.ts` — new adapter. Exports:
  - `setupHmrBridge({port}): HmrBridgeHandle` — page-realm `BridgedWebSocketServer` on `ws://preview.local:<port>/__hmr`, returns `{ url, broadcast, close }`.
  - `hmrClientScript(port)` — vanilla-JS string injected into the preview iframe; mirrors the bridge wire protocol (`open` → `open-ack` → `msg` → `close`) over `BroadcastChannel` directly, so the client needs no `@riftydev/net` import.
  - `createHmrBridgeVitePlugin({port})` — minimal Vite plugin; `transformIndexHtml` idempotently injects the client script before `</body>`.
- `apps/playground/src/adapters/realVite.ts` — calls `setupHmrBridge({port})` before `vite.createServer(...)` so the plugin sees a stable port. Hooks `server.watcher.on('change', file)` to broadcast `{type: 'update', path: file}` through the bridge. Vite native HMR stays off (`server.hmr: false`); Vite still does module-graph invalidation, the bridge delivers the iframe notification.
- `packages/net/src/ws/bridge.ts` — `channelNameFor(url)` is now public API (re-exported via `index.ts` / `ws.ts`). Inlined clients need it so server and client agree on the `BroadcastChannel` name without depending on the full surface. Other shapes (`BridgedWebSocket`, `BridgedWebSocketServer`, `BridgedWebSocketConnection`, `createCrossRealmBridge`, `WsMessage`, `CrossRealmBridge`) were already public; only `channelNameFor` graduated.

### Intentionally not in scope

- The M12 deferral for A-022 / A-024 / A-025 stands; their acceptance criteria are unaffected. Transport is still `BroadcastChannel` (no per-connection isolation, no backpressure) — M12 swaps it for dedicated `MessagePort`.
- `BridgedWebSocket` internals untouched — the wiring closes acceptance with the existing API, no refactor of buffering / backpressure / event-emitter shape.
- Vite's full HMR module-graph protocol (ESM HMR `update` payloads, `accept`/`dispose`) is out of scope. The bridge delivers a naive `{type:'update'}` payload, the iframe reloads — sufficient for M10 acceptance and M11 A-026 forward compat. Real HMR semantics land with the Vite-in-Worker migration.

### Tests

- `apps/playground/src/adapters/hmr-bridge.test.ts` — 9 unit tests: round-trip (client open / broadcast), channel-name contract (server URL ↔ inlined client script), Vite plugin idempotence.
- `tests/e2e/m10-hmr.spec.ts` — Playwright spec driving the full Real Vite flow → file edit → iframe reload. Gated by `RIFTY_E2E_HMR=1` (Real Vite mode costs ~20 s install on cold cache); the unit test covers the wiring contract for CI.
