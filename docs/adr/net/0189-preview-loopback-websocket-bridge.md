# ADR 0189: Preview loopback WebSocket bridge

Status: Accepted (2026-07-02)
Date: 2026-07

> TL;DR: Inject the existing `webSocketBridgeClientScript` into EVERY `text/html` preview response (tool-agnostic, at the cross-realm preview path) with loopback/current-origin WS URLs remapped to the guest port derived from the `/preview/<port>/` prefix — so ANY dev tool's stock WS client (vite HMR, webpack HMR, socket.io) reaches the guest server, and the vite-keyed HMR config wrapper dies.

## Context

The browser has no loopback WebSocket and the SW cannot intercept `ws://` (fetch-only). Both halves of the bridge ALREADY exist in `@riftydev/net`: `webSocketBridgeClientScript` (a self-contained `window.WebSocket` patch speaking a connId-tagged frame protocol over BroadcastChannel, `ws/browser-client-script.ts`) and the guest `HttpServer`'s upgrade listener (`listenForWebSocketUpgrades` → synthesized `'upgrade'` → real npm `ws` works; socket-lab `ws-server-local-upgrade` = supported). The GLUE is the delivery: the script is injected ONLY by the vite config-wrapper's plugin (`createHmrBridgeVitePlugin` → `transformIndexHtml`), and only after the wrapper rewrote vite's HMR endpoint to the synthetic `PREVIEW_LOCAL_HOST` + token path — because a STOCK client aims at `location.host` (the playground origin, whose port-keyed channel has no guest listener). Result: vite HMR works via a vite-keyed `--config` wrapper; webpack HMR / socket.io in the preview silently fail (`browser-preview-websocket` = the tracked `not-yet` socket-lab row).

## Decision

1. **Generic injection point.** The cross-realm preview HTML path (`serveCrossRealmPreview` response side) injects the bridge client script into `text/html` responses, marker-guarded (`data-rifty-ws-bridge`), head-prepended, buffered-body v1 (no streaming HTML rewrite). Every preview document gets the patch — no per-tool plugin.
2. **Guest-port remap in the client script.** The script derives the guest port from the iframe's `/preview/<port>/` pathname prefix and bridges any `ws:`/`wss:` URL whose hostname is loopback (`localhost`, `127.0.0.1`) or `location.hostname`, keying the discovery channel by the GUEST port (URL path/query preserved in the `open` frame; the guest server validates). Non-loopback URLs keep the native `WebSocket` (real egress stays real).
3. **Wrapper retirement is the acceptance, phased per forced option.** The HMR half (`RIFTY_VITE_CLI_HMR`/`RIFTY_VITE_CLI_PORT` env, the wrapper's `server.hmr` rewrite + plugin injection) dies with 1+2. The remaining forced options each need a generic resolution or a drop-with-proof before `withViteCliArgs`/`withViteCliEnv` delete: `allowedHosts`/`host` (candidate: rewrite the request Host to `localhost:<port>` at the preview bridge — generic), `strictPort`, `base: './'`, `optimizeDeps.noDiscovery` (re-test under wasm esbuild), user-config discovery env. The backlog item `net/preview-websocket-bridge` stays open until the wrapper is gone.
4. **Token scoping is dropped for the port channel; the per-server nonce stays available** for explicit `setupHmrBridge` users. The preview channel is same-origin-only (BroadcastChannel), scope-keyed like the HTTP preview bridge; anti-hijack aligns with ADR-0160 ready-frame routing (the port-keyed channel only reaches a server that LISTENS on that port in the guest realm).

Correction (2026-07-07): wrapper retirement acceptance closed. `withViteCliArgs`,
`withViteCliEnv`, `.rifty/vite-cli.config.mjs`, and `RIFTY_VITE_CLI_*` template
gates were deleted; Vite 8 HMR-off and preset dep-optimizer opt-outs moved into
visible seeded `vite.config.js`. The backlog item `net/preview-websocket-bridge`
and `preset-deglue` epic were removed per delete-on-done.

## Consequences

- Any dev server's stock WS client works in the preview — vite untouched-config HMR, webpack-dev-server, socket.io — flipping socket-lab `browser-preview-websocket` to supported (the acceptance gate).
- The last Vite CLI wrapper/argv/env branch is deleted; the remaining Vite-name
  check only identifies real `.bin/vite` children before patching Vite's own CLI
  keepalive/preview-CORS internals.
- Buffered HTML injection adds latency on very large documents (streaming rewrite is a follow-up if measured).
- Close/backpressure semantics remain the bridge protocol's (no send-queue backpressure); real `ws` parity for high-volume streams is out of scope v1 — gaps stay loud in socket-lab.
