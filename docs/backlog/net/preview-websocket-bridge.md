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

RETIRED 2026-07-02 (per-option, acceptance 4 partial): the generic request-Host rewrite LANDED — `synthesizePreviewUrl` stamps `Host: localhost:<port>` (what a real local dev run sends; SW_ROUTING_VERSION 5→6; fork e2e asserts `host=localhost:4100` through the preview path) — retiring `server.host`, the preview-mode `--host preview.local` arg, `base: './'` (SW port-context routes root-relative, ADR-0097), `appType` (vite's own default), `strictPort` (port-derived lifecycle follows any port). Proofs: m10-hmr + manual-vite (bare `vite`, no CLI args/config) + vite7-build-preview + generic-lifecycle e2e green with the forces dropped.

RETIRED 2026-07-06: `server.allowedHosts` (dev wrapper + vite-preview cli patch). The 2026-07-02 "hang, not 403" traced to rifty `node:net` missing `isIP`: vite's `extractHostNameFromHostHeader` calls `net.isIP(hostname)` BEFORE the unconditional localhost allow; the TypeError rejected the ASYNC connect middleware, connect swallowed the rejection (no `next()`, no response) → preview-bridge 30 s timeout. Real `isIP`/`isIPv4`/`isIPv6` (Node-regex port, parity `cases/net/is-ip.case.ts`) landed in `@riftydev/net`. Causal proof one-variable-at-a-time: force removed + isIP reverted → 502 bridge timeout (repro); + isIP present → 200. Proofs green: generic-lifecycle, m1, m7, vite7-build-preview (preview force), preview-websocket-bridge, socket-lab, m10-hmr (`RIFTY_E2E_HMR=1`, ws-upgrade shouldHandle now runs isHostAllowed), manual-vite (`RIFTY_E2E_MANUAL_VITE=1`), vite-hmr-channel integration, net units.

RETIRED 2026-07-07: `optimizeDeps.noDiscovery` as a BLANKET force. The esbuild-wasm replacement was ported from the ai-mode branch ahead of PR #111 (ADR-0192, re-pinned 0.27.7→0.28.0 into lockstep with the `@esbuild/wasi-preview1` trigger): the guest esbuild shim now delegates the REAL JS API (transform/build/context incl. rebuild) to a lazy host esbuild-wasm instance; the WASI transform bridge is deleted. Zero-config `npm i vite && npm run dev` runs vite's REAL dep optimizer — manual-vite e2e green WITH discovery. What survives is a template-declared opt-out (`server.optimizeDepsDisabled` → `RIFTY_VITE_CLI_NO_DEP_DISCOVERY`): zero-dep instant presets keep the 13.5 MB wasm off their boot path (m1 unchanged 4.8 s), vite8 pins off (Rolldown, ADR-0173). Honest cost: vite7-build-preview e2e 7.9→37 s (cold service init in the build child; backlog perf/esbuild-wasm-build-path-latency). Proofs green: manual-vite (flagged), m1, m7, generic-lifecycle, vite7-build-preview, preview-websocket-bridge, socket-lab, m10-hmr (flagged), heavy lane ×14 (typescript preset transforms via esbuild-wasm, no regression), full unit suite + parity.

REMAINING (acceptance 4 — the item stays open until done): delete `withViteCliArgs`/`withViteCliEnv` + the wrapper file (user-config discovery env `RIFTY_VITE_CLI_USER_CONFIG` rides the wrapper). Residuals riding on the wrapper until then: `RIFTY_VITE_CLI_HMR_OFF` (ADR-0161 Vite 8 hmr-off pin), `RIFTY_VITE_CLI_NO_DEP_DISCOVERY` (ADR-0192 template gate), and the `configureServer` server-handle plugin. wss-external-stays-native is unit-pinned (browser-client-script test), no e2e egress case.

**BLOCKER re-checked 2026-07-07 (PR #115 recursive-watch landed): stock chokidar over the polling `fs.watch` does NOT drive real-vite-CLI HMR.** Attempted the full deletion (wrapper + `configureServer` plugin + `rifty:vite-file-change` fan-out), relying on stock vite's own chokidar watcher over `packages/runtime-js/src/builtins/fs-watch.ts`. Proof it fails: `tests/e2e/manual-vite-install.spec.ts` (`RIFTY_E2E_MANUAL_VITE=1`, vite 7 pinned, `vite --port 5174`) — with the bridge deleted, the editor write reaches the editor pane but no vite HMR `update` payload ever arrives in the preview (line 118 `hasNativeUpdatePayload` 30 s timeout); with the wrapper+bridge restored, the SAME test passes in 17.5 s (update fires, `#app` re-renders). So the deletion was reverted; the `configureServer` plugin (publishes `__riftyActiveViteServer`) + the owner→child `rifty:vite-file-change` fan-out are the ONLY working editor-write→HMR path for the REAL vite CLI. Next: either (a) diagnose why stock chokidar 3.6 does not pick up `fs.watch` events for the CLI child's remote-sync-fs view (the CO-RESIDENT dev server, Path A, does NOT need a watcher — it invalidates via `real-vite-invalidation`), or (b) find an alternate plugin-injection home so the wrapper file itself can die while the plugin survives. Until one lands, the wrapper stays and acceptance 4 stays open.

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
