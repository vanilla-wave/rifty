# ADR 0180: Cross-realm http.request loopback via the preview broker

Status: Accepted
Date: 2026-06

> TL;DR: in-sandbox `http.request`/`get` to a loopback port with no LOCAL handler probes the per-port preview `BroadcastChannel`; a realm that owns the port emits an `accept` frame and serves the reply (streaming via ADR-0048 v2); no `accept` within a bounded window → Node-shaped `ECONNREFUSED`. Kernel port-table rejected.

## Context

The port registry is realm-local (`packages/net/src/registry.ts` — a per-Worker `Map<number, PortHandler>`). `routeClientRequest` (`packages/net/src/http/server.ts`) resolves a loopback target against THAT realm's registry only; a miss returns `{ kind: 'refused' }` → fail-fast `ECONNREFUSED` (errno -111, `connect`). So a server-to-server `http.request('http://localhost:3001')` from one supervised-child node process (ADR-0150) cannot reach a server listening in a sibling child realm, even though the port is live there.

The page↔worker preview bridge already crosses realms for the SAME ports: ADR-0043/0048 `bridgeCrossRealmPreview`/`serveCrossRealmPreview` route over a per-port `BroadcastChannel` (`previewPortChannelUrl(port)`), and every served `node <file>` program already registers `serveCrossRealmPreview(port, dispatchToPort)` for each listened port (`apps/playground/src/workers/node-entry-bootstrap.ts:180`). The SERVER side of the cross-realm hop therefore already exists for arbitrary node servers; only the in-sandbox CLIENT side is missing.

## Decision

### D1 — Broker (Option A), not a kernel port-table

The client's `{ kind: 'refused' }` branch routes the request through `bridgeCrossRealmPreview(port, request)` over the existing per-port `BroadcastChannel` before deciding `ECONNREFUSED`. Reuses ADR-0043/0048 transport + frames verbatim; the client path stays inside `@riftydev/net` (`http/server.ts` → `cross-realm/preview-port.ts`, same package — no layering break).

REJECTED — kernel process-spawn-time port table (registries become views): adds a sync RPC on every `listen()`/`request()`, cannot pre-populate ephemeral `listen(0)` ports (allocated after spawn), and leaks cross-PID port visibility. The broker needs none of this and reuses shipped machinery.

### D2 — Ownership `accept` handshake separates no-listener from slow-app

A pure timeout cannot distinguish "no realm owns this port" (must be `ECONNREFUSED`) from "a real handler is slow to first byte". So the request frame doubles as an ownership probe: a realm receiving a request for a port IT owns emits an additive `accept` frame (carrying `PREVIEW_PORT_FRAME_VERSION`, ADR-0031) IMMEDIATELY, before running the handler. The client arms the ADR-0048 no-progress timer on `accept` and then waits for the (possibly slow) reply. No `accept` within a bounded probe window → Node-shaped `ECONNREFUSED`. This is the only new wire element; reply delivery is unchanged ADR-0048.

### D3 — Streaming reuses ADR-0048 v2

Cross-realm replies stream via `reply-stream-*` (SSE/NDJSON/chunked service-to-service); null/finite bodies take the buffered `reply` fast path. (User boundary: streaming in-scope.) No new streaming mechanism.

### D4 — http: loopback only

Cross-realm applies only to `http:` loopback hosts (`isLoopbackHost`). Non-loopback stays host `fetch()` egress; `https:` has no in-browser server (`https.createServer` throws, ADR-0010/0181), so there is no cross-realm https loopback target. The LOCAL registry is still consulted first (`getHandler(port)` → `kind: 'local'`); the broker fires only on a local miss.

### D5 — Cross-realm bind conflicts out of scope

Two realms can still bind the same port (separate registries) — a pre-existing divergence from Node's cross-process `EADDRINUSE`. With the broker, a client reaching a port owned by ≥2 REMOTE realms gets first-acker-wins (local always wins when present). Faithful cross-realm `EADDRINUSE` at `listen()` is a distinct concern, tracked in `docs/backlog/net/cross-realm-listen-eaddrinuse.md`. This ADR does not change bind semantics.

## Consequences

- Service-to-service `http.request`/`get` across realms works, streaming included — closes the loopback gap for multi-process node apps.
- One extra round-trip (`accept`) on the FIRST cross-realm hop; the no-listener case costs the probe window vs Node's instant refuse — acceptable (loopback-only, in-browser; production perf is a non-goal per AGENTS.md).
- The double-bind ambiguity (D5) survives until the `EADDRINUSE` follow-up; documented, not hidden.
- `accept` is additive under `PREVIEW_PORT_FRAME_VERSION`; a pre-0180 peer never emits it, so an old server is simply unreachable cross-realm (→ `ECONNREFUSED`) rather than mis-answered — degrade-per-peer (ADR-0031).

## References

- ADR-0043 (cross-realm preview bridge), ADR-0048 (streaming wire-frame), ADR-0147 (default cross-realm WS bridge), ADR-0017 (net scope), ADR-0150 (supervised child processes), ADR-0031 (per-frame versioning).
- `packages/net/src/http/server.ts` (`routeClientRequest`), `packages/net/src/cross-realm/preview-port.ts`, `apps/playground/src/workers/node-entry-bootstrap.ts`.
