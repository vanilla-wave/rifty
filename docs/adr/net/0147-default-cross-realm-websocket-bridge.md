# ADR 0147: Default cross-realm WebSocket bridge

Status: Accepted
Date: 2026-06-14

> TL;DR: default `@riftydev/net` WebSocket now crosses same-origin realms via
> the bridge protocol; HMR uses ordinary WebSocket semantics instead of a
> Vite-only browser socket patch.

## Context

ADR-0017 deferred A-025 cross-realm WebSocket together with the larger M12
streaming/raw-TCP rewrite. That made sense while `WebSocket`/`WebSocketServer`
were same-realm only: a preview iframe's native `new WebSocket()` could not
reach a Worker-side or page-side in-process `WebSocketServer`.

ADR-0145 then got real-Vite HMR working through Vite's `server.hmr.channels`,
but the browser transport was still a targeted `"vite-hmr"` patch. That fixed
Vite, not the ecosystem surface: another dev client creating a normal
same-origin `WebSocket` would still miss rifty's server. ADR-0151 later moved
Real-Vite off `server.hmr.channels` and onto Vite's native `server.ws`.

## Decision

- The default `WebSocket`/`WebSocketServer` in `@riftydev/net` keep the
  same-realm listener fast path, then fall back to the same-origin bridge.
- Servers listen on both the historical URL channel and a port discovery
  channel. `open` frames carry the requested URL; the server validates
  host/port/path before accepting, so wildcard hosts work without hardcoded
  preview host lists.
- `createCrossRealmBridge()` stays as an opt-in compatibility facade. Its
  clients also announce on the port channel, so old bridged clients can connect
  to ordinary `WebSocketServer` instances.
- `webSocketBridgeClientScript()` is public API: hosts inject it before framework
  dev clients run; it patches browser `window.WebSocket` for configured
  same-origin preview hosts and leaves other URLs to native WebSocket.
- Workbench injects the generic browser bridge before framework dev clients run.
  Mini-dev still hosts an ordinary `WebSocketServer`; Real-Vite reaches Vite's
  native `server.ws` through ADR-0151's HTTP upgrade bridge.

This supersedes ADR-0017's A-025 deferral and ADR-0145's transport clauses.
ADR-0017 still owns streaming body/backpressure/raw-TCP work; ADR-0151 owns the
HTTP WebSocket upgrade path used by Real-Vite.

## Consequences

- (+) A rifty-hosted browser dev client can use ordinary `new WebSocket(url)`;
  Vite HMR is one consumer, not the special case that defines the transport.
- (+) Wildcard `WebSocketServer({ port, path })` accepts cross-realm clients for
  non-`localhost` preview hosts.
- (+) Existing `BridgedWebSocket*` callers keep working and interop with the
  default surface.
- (=) Same-origin `BroadcastChannel` remains the carrier. It is not raw TCP,
  has no true backpressure, and is scoped to rifty-hosted preview realms.
- (=) M12 streaming/raw-TCP work remains open for chunked/SSE bodies and real
  `net.Socket`; it is no longer required for same-origin WebSocket/HMR.

## Acceptance

- [x] Conformance proves default server ↔ bridged client, default client ↔
  bridged server, and wildcard-host cross-realm routing.
- [x] Unit coverage proves the generated browser `window.WebSocket` shim reaches
  an ordinary `WebSocketServer`.
- [x] Workbench HMR unit coverage proves injected HTML uses the generic bridge
  script; ADR-0151 integration coverage proves Vite payloads flow over native
  `server.ws`.
