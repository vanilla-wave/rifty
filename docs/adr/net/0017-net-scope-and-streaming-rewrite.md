# ADR 0017: `@riftydev/net` scope statement and streaming rewrite deferral

Status: Accepted
Date: 2026-05

> Correction 2026-06-16: ADR-0147 closes the A-025 cross-realm WebSocket
> deferral for same-origin WebSocket/HMR via the default BroadcastChannel bridge.
> This ADR's M12 deferral remains for A-022/A-024 and WebSocket transport
> hardening (dedicated `MessagePort`, isolation, backpressure), not for basic
> cross-realm `WebSocket` reachability.

**Decision (2026-05-26, corrected 2026-06-16):** A-022 (chunked transfer + streaming response) and A-024 (raw TCP `net.Socket`) are deferred to **M12 (target = end of August 2026)**. A-025's original reachability gap is superseded by ADR-0147; M12's remaining WebSocket scope is transport hardening. M12 rewrite scope:

- `SerializedResponse` body becomes `ReadableStream<Uint8Array>`, Transferable across realms via the cross-realm bridge from ADR-0011.
- Cross-realm WebSocket bridge uses a dedicated `MessagePort` per connection instead of the current `BroadcastChannel` (no per-connection isolation, no backpressure).
- **New for M12 (2026-05-27):** the cross-realm preview-port bridge from **ADR-0043** (`@riftydev/net.bridgeCrossRealmPreview` / `serveCrossRealmPreview`) shares the same `BroadcastChannel` carrier and the same buffered, no-backpressure limit. M12 swaps both bridges to dedicated `MessagePort`s in one pass; SSE / long-poll over a Real Vite preview hangs until then.
- `net.Socket` gains a full TCP-shape surface (raw byte streaming; `_write`/`_read` honour `chunk`, not HTTP frames). Where TCP semantics can't be faithfully emulated in a browser (e.g. `localAddress` selection), the TSDoc declares the limitation final.

M12 starts only after M11 ships ADR-0011's worker-as-process — the bridge is the load-bearing primitive.

> TL;DR: `@riftydev/net`'s chunked/SSE and raw-TCP gaps defer to one M12 rewrite:
> `ReadableStream` body + per-conn `MessagePort`; ADR-0147 already closed basic
> same-origin cross-realm WebSocket reachability over today's `BroadcastChannel`.

## Context

`@riftydev/net` today provides `node:http` over a buffered `Response`-shape RPC with the body fully materialised before delivery. `node:net.Socket` is built on the HTTP layer (carries HTTP-shape frames, not raw bytes). `node:ws` was originally same-realm only; ADR-0147 later closed basic same-origin cross-realm reachability. Three REVIEW_ACTIONS entries — A-022 (chunked transfer), A-024 (raw TCP via `net.Socket`), A-025 (cross-realm WebSocket) — were symptoms of the same buffered-RPC constraint.

The clean fix for all three is a streaming `SerializedResponse` (body = `ReadableStream<Uint8Array>` Transferable across realms) plus ADR-0011's cross-realm bridge. Ad-hoc per-method fixes would each re-refactor the same surface.

## Decision

Document `@riftydev/net`'s current scope explicitly; defer the streaming rewrite to one milestone addressing all three gaps together.

- Current scope (in `packages/net/README.md` + public TSDoc):
  - `node:http` carries fully-buffered responses; long-poll and SSE will not stream.
  - `node:net.Socket` is HTTP-shape only, not a general raw TCP socket.
  - `node:ws` basic same-origin cross-realm reachability is shipped by ADR-0147 over `BroadcastChannel`.
- Future state (M12, after ADR-0011's worker-as-process lands in M11):
  - `SerializedResponse` becomes `{ status, headers, body: ReadableStream<Uint8Array> }`, transferred across realms via the bridge.
  - `net.Socket` gains raw byte streaming on the same primitive, or its TSDoc declares the HTTP-shape limitation final.
  - `node:ws` cross-realm transport moves from `BroadcastChannel` to dedicated `MessagePort` channels with isolation/backpressure.

## Consequences

- The three gaps unblock together rather than in three refactor passes.
- Until M12, real packages relying on chunked transfer, raw TCP, or WebSocket backpressure/isolation beyond ADR-0147 fail loudly (or behave per documented scope).
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

Corrected 2026-06-17: the 2026-05-26 phase-1 HMR adapter was later superseded
by ADR-0147 + ADR-0151. Current Real-Vite uses Vite native `server.ws` over
rifty `http.Server.on('upgrade')`; it no longer calls `setupHmrBridge`, disables
Vite HMR, or broadcasts naive `{type:'update'}` payloads.

- `apps/playground/src/glue/hmr-bridge.ts` — still owns the mini-dev
  `setupHmrBridge` broadcaster and injects the generic browser `WebSocket`
  bridge before dev clients run.
- `apps/playground/src/workers/real-vite-bootstrap.ts` — injects the generic
  browser bridge and lets Vite's native watcher/module graph generate HMR
  payloads over its own `server.ws`.
- `packages/net/src/ws/bridge.ts` + `packages/net/src/http/upgrade-socket.ts` —
  same-origin bridge transport plus RFC6455 HTTP upgrade socket used by real npm
  `ws` and Real-Vite.

### Intentionally not in scope

- The M12 deferral for A-022 / A-024 stands. A-025 reachability is closed by
  ADR-0147/0151; raw TCP remains out of scope. Transport is still
  `BroadcastChannel` (no per-connection isolation, no backpressure) — M12 swaps
  it for dedicated `MessagePort`.
- `BridgedWebSocket` internals untouched — the wiring closes acceptance with the existing API, no refactor of buffering / backpressure / event-emitter shape.
- Vite's full HMR module-graph protocol is no longer deferred here: ADR-0151
  makes Real-Vite one consumer of the generic HTTP WebSocket upgrade path.

### Tests

- `apps/playground/src/glue/hmr-bridge.test.ts` — mini-dev bridge + generic
  browser bridge injection.
- `tests/integration/vite-hmr-channel.test.ts` — Vite native `server.ws`
  generates `update.updates[]` through rifty `http.Server.on('upgrade')`.
- `tests/e2e/m10-hmr.spec.ts` — browser flow proves file edit patches without
  iframe reload. Gated by `RIFTY_E2E_HMR=1`.
