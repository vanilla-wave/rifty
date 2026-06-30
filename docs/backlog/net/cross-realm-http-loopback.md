---
area: net
status: ready
title: http.request loopback across Worker realms (port registry is realm-local)
created: 2026-06-12
why: loopback routing (PR #21) only reaches servers registered in the SAME Worker realm; service-to-service calls between two sandbox processes get ECONNREFUSED even though the port is live in another Worker
user_story: As a developer running two sandbox node services — `node gateway.js` (Express, :3000) and `node api.js` (Express, :3001) — where gateway does `http.request('http://localhost:3001/users')` to api, I want the call to reach api, but today the realm-local registry returns ECONNREFUSED even though :3001 is live in api's realm.
sources: [ADR-0180, ADR-0043, ADR-0048, ADR-0150, "net/http-request-loopback-own-ports (closed, PR #21)"]
code: [packages/net/src/http/server.ts, packages/net/src/cross-realm/preview-port.ts, packages/net/src/registry.ts]
---

## Context

The port registry is a realm-global `Map<number, PortHandler>` per Worker (`registry.ts`). `routeClientRequest` (`http/server.ts`) resolves a loopback target against only that realm's registry; a miss returns `{ kind: 'refused' }` → fail-fast Node-shaped `ECONNREFUSED` (PR #21 review fix; before that it leaked to the host's real loopback via `fetch`). The cross-realm SERVER side already exists: every served `node <file>` program registers `serveCrossRealmPreview(port, dispatchToPort)` per listened port (`node-entry-bootstrap.ts:180`) over the per-port `BroadcastChannel` (ADR-0043/0048). Only the in-sandbox CLIENT side is missing — the gap ADR-0180 closes.

## User scenario

A developer builds a two-service app in the sandbox: `api.js` is an **Express** server (`app.get('/users', …); app.listen(3001)`) and `gateway.js` is an **Express** server on :3000 that proxies `GET /users` by calling `http.get('http://localhost:3001/users', …)`. They start both from the terminal (`node api.js` in one tab, `node gateway.js` in another — each a supervised-child realm, ADR-0150) and open the gateway preview. Today the gateway's call throws `Error: connect ECONNREFUSED 127.0.0.1:3001` even though api is live in its own realm. After this item the gateway receives api's JSON; and api's SSE endpoint (`GET /events`, `text/event-stream`) proxied through the gateway streams event-by-event to the browser, not buffered-until-end.

## Acceptance

E2E with two supervised-child node servers (ADR-0150):
- gateway's `http.request`/`http.get` to a loopback port owned by api's realm returns api's real response — status, headers, and body byte-exact;
- an SSE / NDJSON endpoint on api streams chunk-by-chunk to gateway (a chunk is readable before api calls `end()`), not buffered-until-end;
- a request to a loopback port NO realm owns fails with the exact Node `ECONNREFUSED` shape (no host `fetch` leak);
- a LOCAL (same-realm) port still resolves from the local registry with no cross-realm broadcast.
An approximation that buffers streams, leaks to the host, or hangs on a no-listener port fails this.

## Parity cases

- `http.request` to a remote-realm port → `'response'` fires with `statusCode`/`statusMessage`/`headers` and a body byte-identical to the server's, exactly like a same-process Node loopback call.
- `http.get` shorthand to a remote-realm port → same, request auto-ended.
- SSE (`text/event-stream`) from a remote realm → each `data:` event decodable on the client before the server's stream ends (chunk-per-`write()` timing), matching Node loopback SSE.
- POST with a request body to a remote realm → body delivered intact (chunk boundaries preserved); the server's `IncomingMessage` reads it; response returned.
- No-listener loopback port → `'error'` emits `connect ECONNREFUSED <addr>:<port>` with `code:'ECONNREFUSED'`, `errno:-111`, `syscall:'connect'`, `address` (`127.0.0.1`/`::1`), `port`; `fetch` is NOT called.
- Local (same-realm) registered port → served locally, no broadcast round-trip (deterministic, no probe latency).

## Out of scope

- Cross-realm `https:` loopback — no in-browser https server (`https.createServer` throws, ADR-0010/0181); a `https://localhost:P` cross-realm target throws / `ECONNREFUSED`, never fake TLS.
- Cross-realm `EADDRINUSE` at `listen()` — two realms may still bind the same port; faithful cross-process bind-conflict detection is `net/cross-realm-listen-eaddrinuse` (draft). A client reaching a port owned by ≥2 REMOTE realms is first-acker-wins (documented divergence, ADR-0180 D5), never a silent wrong answer for the single-owner case.
- Raw TCP `net.Socket.connect` and non-loopback hosts — unchanged loud `NotImplementedError` (ADR-0017).
- The browser→sandbox preview path (`/preview/<port>/*`) — already shipped (ADR-0043), not re-scoped.

## Decisions

- Mechanism = broker over the per-port preview `BroadcastChannel` reusing `bridgeCrossRealmPreview`/`serveCrossRealmPreview`; kernel port-table rejected (ADR-0180 D1).
- No-listener vs slow-app distinguished by an additive `accept` ownership frame; 0 acks within the bounded probe window → `ECONNREFUSED` (ADR-0180 D2).
- Streaming in-scope, reuses ADR-0048 v2 frames (ADR-0180 D3) — user boundary.
- `http:` loopback only; the local registry is consulted first (ADR-0180 D4).
- IRREVERSIBLE (new cross-realm client dispatch + `accept` frame) → ADR-0180 exists.

## Reversibility

IRREVERSIBLE — new cross-realm dispatch path + additive wire frame; recorded in ADR-0180.
