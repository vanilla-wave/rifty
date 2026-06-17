---
area: net
status: parked
title: Node-realm ws client to an external (non-local) host — open native WebSocket instead of loud-erroring
created: 2026-06-18
why: a worker realm CAN open a real WebSocket to an external wss:// host (it is a native browser primitive, unlike raw TCP), but the node:http upgrade client rejects every non-local host — so a guest `ws` client to a real remote WS server fails where the browser realm already passes through
user_story: As a guest running `const ws = require('ws'); new WebSocket('wss://api.example.com')` inside a rifty worker, I want it to reach the real external server like the browser realm does — can't, the http upgrade client only routes registered local ports and emits "WebSocket client upgrades require a registered rifty local port".
sources: [ADR-0147, ADR-0017, PR#42 review (post-merge gap surfaced in scope discussion)]
---
## Context
Asymmetry between realms today:
- **Browser realm**: `webSocketBridgeClientScript`'s shim only bridges configured preview hosts (`shouldBridge` host allow-list); any other URL falls through to the native `window.WebSocket`. So `new WebSocket('wss://external')` already works in the page/preview iframe.
- **Node/worker realm**: the real `ws` package issues `http(s).request()` with upgrade headers; `routeClientRequest` (packages/net/src/http/server.ts) returns `fetch` for a non-loopback host, and `request()`'s upgrade branch requires `route.kind === 'local'`, otherwise emits `Error('WebSocket client upgrades require a registered rifty local port')` (server.ts ~:408). So a guest `ws` client to a real remote WS server loud-fails.

This is NOT the raw-TCP ceiling (ADR-0017 A-024): WebSocket egress is a first-class browser/worker primitive, so the worker can genuinely connect out. The current loud throw is honest, just not yet implemented and previously untracked.

## Options / Next
In the http upgrade-client path, when the target host is non-local (and not refused), open a real native `WebSocket(wsUrl, protocols)` in the worker realm and bridge its `open`/`message`/`close`/`error` to the `WebSocketClientSocket` + `'upgrade'` emitter (no BroadcastChannel — this leg is a real socket). Keep loopback/local hosts on the existing in-process bridge. Subject to the remote endpoint supporting WS and to browser origin rules. Failing parity test first: a guest `ws` client reaches a stub external WS endpoint and round-trips a message.

## Reversibility
REVERSIBLE — additive route for non-local WS clients; no public API change, no wire contract change, loopback path untouched. (Real-network egress remains the documented external boundary — this only uses the browser's own WebSocket egress, never raw TCP.)
