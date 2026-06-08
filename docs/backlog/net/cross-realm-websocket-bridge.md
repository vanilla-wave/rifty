---
area: net
status: parked
title: Cross-realm WebSocket bridge (real-TCP WebSocket; current layer is in-process only)
created: 2026-06-08
why: WebSocket/WebSocketServer are in-process URL-routed only; real-socket wiring is an explicit follow-up
sources: [TASKS M7, A-025, ADR-0017]
---
## Context
M7 open acceptance + m10-tooling ⚠️ rows: `@riftydev/net` `WebSocket` + `WebSocketServer` + `WebSocketConnection` are in-process, same-realm URL-routed only (`'open'`/`'message'`/`'close'` lifecycle, `broadcast` for HMR; 5 conformance tests). The API is browser-`WebSocket`/Node-`ws` shaped so the day it's wired to a real socket user code doesn't change. The HMR cross-context case (iframe HMR client over a real `WebSocket` reaching a Worker-side server) needs a network hop — currently solved by running the dev server in the main-thread realm. ADR-0017 records this as the M12 cross-realm WebSocket bridge intent (A-025).

## Options / Next
Likely wiring (per m10-tooling notes): a Service-Worker-mediated `fetch`-upgrade or a `BroadcastChannel`-based main-thread bridge. Note the HMR `BridgedWebSocket*` (ws/bridge.ts) already rides a same-origin BroadcastChannel but is HMR-only and does NOT cover the HTTP request/response that SSE rides. Next: design the real-socket carrier when iframe-loaded HMR over a real WebSocket is required end-to-end. Gate: M12 / cross-realm bridge endgame.

## Reversibility
REVERSIBLE for the additive API (shape already swap-ready); the transport choice is a versioned-contract design. Parked — M7/M12 open acceptance, no current consumer past in-process HMR.
