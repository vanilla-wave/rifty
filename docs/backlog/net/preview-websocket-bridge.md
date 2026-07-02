---
area: net
status: ready
title: Generic loopback WebSocket bridge for the preview frame
created: 2026-07-02
why: the browser has no loopback WebSocket, so preview WS works only for vite and only via a vite-keyed `--config` wrapper that rewrites the HMR endpoint + injects the bridge script through a vite plugin — any other tool's WS (webpack HMR, socket.io) silently fails
user_story: As a developer, I want the stock HMR/WS of ANY dev server to work in the preview (vite with untouched config, webpack-dev-server, a socket.io app), but today only vite works, and only because rifty rewrites its CLI args and injects a plugin.
epic: preset-deglue
blocked_by: []
sources: [docs/adr/net/0189-preview-loopback-websocket-bridge.md, docs/adr/service-worker/0123-port-aware-preview-owner-routing.md]
code: [packages/net/src/ws/browser-client-script.ts, packages/net/src/http/server.ts, packages/net/src/registry.ts, apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/glue/hmr-bridge.ts]
---

## Context

Both bridge halves already exist in `@riftydev/net` (`webSocketBridgeClientScript` + `HttpServer.listenForWebSocketUpgrades`; socket-lab `ws-server-local-upgrade` = supported). The glue is delivery: the client script is injected only by the vite wrapper's plugin, after the wrapper rewrote vite's HMR endpoint — a stock client aims at `location.host` (playground origin) whose port-keyed channel has no guest listener. Design ratified in ADR-0189: generic `text/html` injection at the cross-realm preview path + guest-port remap derived from the `/preview/<port>/` prefix.

## Acceptance

- The preview HTML path injects the bridge client script into every `text/html` response (marker-guarded, head-prepend); the script bridges `ws:`/`wss:` URLs whose hostname is loopback or `location.hostname` to the GUEST port derived from the `/preview/<port>/` pathname prefix; non-loopback URLs keep native WebSocket.
- Vite preset HMR works with the wrapper's `server.hmr` rewrite + `createHmrBridgeVitePlugin` injection + `RIFTY_VITE_CLI_HMR`/`RIFTY_VITE_CLI_PORT` env DELETED (stock vite HMR config end-to-end): edit a file → preview updates, e2e-asserted.
- A NON-vite WS client works in the preview: e2e with a bare `ws` (or socket.io) echo server — the preview page's `new WebSocket('ws://localhost:<port>/…')` round-trips a message. Flip the socket-lab `browser-preview-websocket` matrix row to `supported` (its self-test is the in-preset gate).
- Each REMAINING wrapper-forced option retires with its own proof or explicit follow-up recorded IN THIS ITEM (allowedHosts/host via generic request-Host rewrite at the preview bridge; strictPort; `base: './'`; `optimizeDeps.noDiscovery` re-tested under wasm esbuild; user-config discovery env). The item closes only when `withViteCliArgs`/`withViteCliEnv` and the wrapper file are deleted — no silent leftovers.
- All existing preset e2e stay green.

## Parity cases

- Stock `vite` dev with a USER `vite.config.js` carrying custom `server.hmr` (port only): behavior matches real Node vite semantics (config honored; bridge transparent).
- `ws` npm package echo server in the preview page: message round-trip + `close(code, reason)` propagates a faithful CloseEvent (existing close-event parity tests extend to the preview path).
- A `wss://` external URL in the preview keeps NATIVE WebSocket (no bridge interception of real egress).

## Out of scope

- Streaming HTML rewrite (buffered v1; follow-up only if measured).
- Send-queue backpressure parity with real `ws` under high volume — socket-lab keeps it loud.
- Non-HTML injection surfaces (SSE, worker scripts).

## Decisions

- All ratified in ADR-0189: injection at `serveCrossRealmPreview` response side; guest-port remap in the client script; phased wrapper retirement with per-option proofs; port-channel scoping (no token) for the preview path.
