---
area: net
status: draft
title: Generic loopback WebSocket bridge for the preview frame
created: 2026-07-02
why: the browser has no loopback WebSocket, so HMR works only via a vite-keyed `--config` wrapper + injected vite plugin — any other tool's WS (webpack HMR, socket.io) silently fails in the preview
user_story: As a developer, I want the stock HMR/WS of ANY dev server to work in the preview (vite with untouched config, webpack-dev-server, a socket.io app), but today only vite works, and only because rifty rewrites its CLI args and injects a plugin.
epic: preset-deglue
blocked_by: []
sources: [docs/adr/service-worker/0123-port-aware-preview-owner-routing.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, packages/net/src/net.ts, packages/net/src/registry.ts]
---

## Context

The service worker cannot intercept `ws://` (fetch-only), so the fix sits at the platform boundary: the preview-frame bootstrap patches `window.WebSocket` for `ws://localhost:*` / `127.0.0.1:*` and bridges frames into the guest realm's net layer, where the server sees a normal `upgrade`. Then vite's stock HMR config works untouched → delete the HMR half of `withViteCliArgs`/`withViteCliEnv`/the wrapper plugin — the last vite-keyed branch (see `playground/generic-dev-server-lifecycle`). Any client library in the preview (webpack HMR runtime, socket.io-client) gets the same bridge for free.

Ground truth (socket-lab capability matrix, verified 2026-07-02): the GUEST side already works — `ws-server-local-upgrade` = supported (real npm `ws` `WebSocketServer({server})` + in-realm ws client over the net upgrade path); `browser-preview-websocket` = the tracked `not-yet` row this item flips. So the gap is ONLY (a) the iframe→guest duplex transport and (b) the injected `window.WebSocket` patch. The preview iframe and the guest realm already share a same-origin BroadcastChannel transport (`bridgeCrossRealmPreview`/`serveCrossRealmPreview`) — connId-tagged WS frames over the same channel style avoids MessagePort transfer through the SAB kernel IPC entirely.

Injection point: the preview HTML response path (bridge or SW) injects the bootstrap script into `text/html` — tool-agnostic replacement for the vite plugin's `transformIndexHtml`.

The config wrapper carries MORE than HMR — each forced option needs a generic resolution or a drop-with-proof before the wrapper dies: `server.allowedHosts`/`host` (vite rejects the synthetic preview host — candidate: rewrite Host to localhost at the bridge, generic), `strictPort`, `base: './'`, `optimizeDeps.noDiscovery` (bundler-discovery workaround — re-test under wasm esbuild), plus the vite `cli.js` keepalive patch (separate, stays in install-time patch land).

Open forks → ADR before ready: connId frame protocol + close/backpressure semantics vs real `ws`; injection mechanics (bridge vs SW, streaming HTML); `window.WebSocket` patch scope + anti-hijack (align ADR-0160 ready-frame rules); per-forced-option wrapper retirement plan; flip the socket-lab `browser-preview-websocket` row to supported as the acceptance gate.
