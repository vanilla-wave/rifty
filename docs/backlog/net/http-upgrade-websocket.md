---
area: net
status: parked
title: http.Server WS/SSE upgrade (server.on('upgrade'), res.assignSocket)
created: 2026-06-08
why: Port-registry bridge carries buffered+chunked HTTP only; no socket hijack — owned by feature 07
user_story: As a developer wiring a WebSocket server, I want `server.on('upgrade')` + `res.assignSocket` to hijack the socket, but currently the port-registry bridge carries buffered HTTP only — no socket hijack, upgrade/`ws` shim refused.
sources: [feature-07-ws-sse-bridge, ADR-0040, ADR-0048]
---
## Context
m10-tooling ❌ row: `http.Server` WS/SSE upgrade (`server.on('upgrade')`, `res.assignSocket`) is unsupported — owned by feature 07 (opencode facade). The port-registry bridge carries buffered + chunked HTTP only (ADR-0040/0048); there is no socket hijack. `ServerResponse` exposes no `assignSocket`; an upgrade is never silently routed through the buffered `'request'` path (negative test in `server.test.ts` locks this — feature-05 T5). Effect's `httpServer.ts` uses `assignSocket` + `server.on('upgrade')`, deliberately excluded from feature 05.

## Options / Next
opencode's only true WebSocket is the PTY-connect route, a HARD BLOCKER (native PTY) — stays a throw-on-connect stub. The `/event` SSE route is reclassified as streaming-HTTP, NOT a WebSocket (feature 07), so a `ws`/upgrade shim is explicitly refused. Next: keep the negative-test boundary lock; do not wire a silent upgrade path. Gate: never for PTY-connect; SSE rides streaming HTTP instead.

## Reversibility
Refusing an upgrade/`ws` shim is a recorded NEGATIVE architectural commitment (ADR-0055; feature-07 Decision 1, IRREVERSIBLE if revisited). Parked — the buffered-only boundary is intentional and test-locked.
