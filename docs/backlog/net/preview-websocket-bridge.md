---
area: net
status: draft
title: Generic loopback WebSocket bridge for the preview frame
created: 2026-07-02
why: the browser has no loopback WebSocket, so HMR works only via a vite-keyed `--config` wrapper + injected vite plugin — any other tool's WS (webpack HMR, socket.io) silently fails in the preview
user_story: As a developer, I want the stock HMR/WS of ANY dev server to work in the preview (vite with untouched config, webpack-dev-server, a socket.io app), but today only vite works, and only because rifty rewrites its CLI args and injects a plugin.
epic: preset-deglue
blocked_by: [playground/generic-dev-server-lifecycle]
sources: [docs/adr/service-worker/0123-port-aware-preview-owner-routing.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, packages/net/src/net.ts, packages/net/src/registry.ts]
---

## Context

The service worker cannot intercept `ws://` (fetch-only), so the fix sits at the platform boundary: the preview-frame bootstrap patches `window.WebSocket` for `ws://localhost:*` / `127.0.0.1:*` and bridges frames into the guest realm's net layer, where the server sees a normal `upgrade`. Then vite's stock HMR config works untouched → delete `withViteCliArgs`/`withViteCliEnv`/`viteConfigArg` stripping, the HMR bridge plugin, and the `RIFTY_VITE_CLI_*` env — the last vite-keyed branch (see `playground/generic-dev-server-lifecycle`). Any client library in the preview (webpack HMR runtime, socket.io-client) gets the same bridge for free.

Open forks → ADR before ready: bridge transport (MessagePort chain vs BroadcastChannel), upgrade semantics inside `net` (real `http` upgrade event parity), `window.WebSocket` patch scope + anti-hijack routing (align with ADR-0160 ready-frame rules), close/backpressure semantics vs real `ws`.
