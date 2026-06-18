---
area: net
status: active
title: Relay WebSocket ping/pong end-to-end through the bridge transport
created: 2026-06-18
why: server-origin pong is dropped at the upgrade socket, so a real `ws` client peer's `client.ping()` + `on('pong')` keepalive never resolves across the bridge
sources: [PR#42 review fid-ws-ping-pong, ADR-0151]
---
## Context
`WebSocketUpgradeSocket.handleServerFrame` (upgrade-socket.ts) answers server-origin PING locally (auto-pong) and drops server-origin PONG. ADR-0151 accepts transport-answered pings, so this is documented, not a lie. But the native↔native path (real `ws` client → `WebSocketClientSocket` → bridge `msg`+opcode → `WebSocketUpgradeSocket` → ws server → pong) has no return route: the server pong is dropped, so `on('pong')` never fires and `ws` ping-keepalive RTT can't be measured across the bridge.

## Options / Next
Forward server-origin ping/pong to the bridge as `msg`+opcode (mirror `WebSocketClientSocket.handleClientFrame`), keep the local auto-pong so the ws server's own keepalive stays satisfied, and guard the bridge clients (shim, in-process, BridgedWebSocket) to ignore control-opcode `msg` frames (they can't carry control frames to a browser `WebSocket`). Then update ADR-0151's consequence line. Needs a parity test: real `ws` client `ping()` resolves `on('pong')` through the bridge.

## Reversibility
REVERSIBLE — additive relay + client guards behind a parity test. Touches ADR-0151's documented behavior, so confirm the auto-pong-vs-relay duplication trade-off when picking it up.
