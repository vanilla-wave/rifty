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

### Phase state (2026-07-02)

DELIVERED (acceptance 1–3 + 5): generic marker-guarded (`data-rifty-ws-bridge`) injection inside `serveCrossRealmPreview` (buffered html reply, content-length re-stamped; content-encoded html: gzip/deflate decompressed pre-injection + re-served identity, undecodable coding refused LOUD — no silently uninjected pass; header-charset honoured on decode + content-type re-stamped utf-8, unknown/meta-only non-utf8 charset refused LOUD; a CSP that would block the inline bridge script logs a LOUD console.error — injection still ships, a real fix (hash-amended CSP) only if a real dev server ever sends one); client `previewPortFromPath` remap (loopback/page-hostname → guest-port channel; the `open` frame carries the guest-visible URL — a page-origin URL resolved under the iframe's `/preview/<port>/` base gets the prefix stripped exactly like the SW does for HTTP, non-loopback stays native); `HttpServer` upgrade accepts foreign-URL-port opens (channel = port intent); wrapper HMR half DELETED (`server.hmr` rewrite, `pluginSource` client injection, `RIFTY_VITE_CLI_HMR`/`RIFTY_VITE_CLI_PORT` env, `viteHmrClientScript`/`createHmrBridgeVitePlugin`, dev-server-boot bespoke hmr wiring) — stock vite HMR proven end-to-end (default gate: integration `vite-hmr-channel` stock case; full browser install path: `manual-vite-install` e2e, OPT-IN `RIFTY_E2E_MANUAL_VITE=1` like `m10-hmr`'s `RIFTY_E2E_HMR` — NOT in the default e2e lanes, run per epic verification); socket-lab `browser-preview-websocket` = supported (echo + server-close parity probe) + new `preview-websocket-bridge.spec.ts` (bare `ws` echo via explicit `ws://localhost:<port>` in the preview frame + faithful server `close(code, reason)` CloseEvent = parity case 2 on the preview path). Editor-write invalidation survives via a minimal `configureServer`-only wrapper plugin (`__riftyActiveViteServer`).

RETIRED 2026-07-02 (per-option, acceptance 4 partial): the generic request-Host rewrite LANDED — `synthesizePreviewUrl` stamps `Host: localhost:<port>` (what a real local dev run sends; SW_ROUTING_VERSION 5→6; fork e2e asserts `host=localhost:4100` through the preview path) — retiring `server.host`, the preview-mode `--host preview.local` arg, `base: './'` (SW port-context routes root-relative, ADR-0097), `appType` (vite's own default), `strictPort` (port-derived lifecycle follows any port). The vite-template auto-boot line now keeps only `--port <template-port>`; no generated `--host`/`--strictPort` remains. Proofs: project-spec unit pins the auto-boot line; manual-vite stops the preset server before bare `npm run dev` (no stale preview owner can satisfy the check); vite7-build-preview + generic-lifecycle e2e green with the forces dropped.

REMAINING (acceptance 4 — the item stays open until done): TWO forces survive with re-test data (2026-07-02): `optimizeDeps.noDiscovery` — with the force dropped, zero-config `npm i vite && npm run dev` lights LIVE but the optimizer breaks page serving (the WASI-bridge esbuild shim loud-refuses entry-point contexts); needs a real bundling esbuild (esbuild-wasm replaces the shim on the ai-mode branch, PR #111) — re-retire after that lands. `server.allowedHosts` — the Host rewrite did NOT free it: guest vite request dispatch HANGS without `allowedHosts: true` even with `Host: localhost:<port>` (preview-bridge 30 s timeout, not a 403 — vite's host-middleware path stalls under rifty net, root cause untraced; same force kept in the vite-preview cli patch; the hang is also recorded as `service-worker/preview-blocked-host-hang` (epic fault-honest-sw-preview) — reconcile the two when the trace lands). Trace the hang, then retire. Then delete `withViteCliArgs`/`withViteCliEnv` + the wrapper file (user-config discovery env `RIFTY_VITE_CLI_USER_CONFIG` rides the wrapper). Residuals riding on the wrapper until then: `RIFTY_VITE_CLI_HMR_OFF` (ADR-0161 Vite 8 hmr-off pin) and the `configureServer` server-handle plugin (needs a home if the wrapper dies — vite still needs editor-write invalidation, the VFS has no watcher events). wss-external-stays-native is unit-pinned (browser-client-script test), no e2e egress case.

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
