# ADR 0095: Dev-mode HMR routes through the cross-realm bridge (pluggable dev-server transport)

Status: Accepted (2026-06-08)
Date: 2026-06-08

> TL;DR: dev-mode preview goes live by routing HMR through the same cross-realm BroadcastChannel bridge real-Vite uses, via an optional pluggable `hmr` transport on the example dev server

## Context
Dev-mode preview was not live: editing a file required a manual page reload. The mini dev server (`examples/vite-like-dev`) detects changes via `fs.watch` and broadcasts `{type:'update'}` over an **in-process** `@riftydev/net.WebSocketServer`, and injects a native-`WebSocket` HMR client into served HTML. But the preview iframe is a **separate realm** (served through the SW), and its native `WebSocket` can't reach an in-process server (no real TCP, no SW WS-upgrade interception) — so the broadcast never arrived and the iframe never reloaded.

Real-Vite mode already solved the identical realm-boundary problem with the cross-realm `BroadcastChannel` HMR bridge (`setupHmrBridge` + `hmrClientScript`, ADR-0017 phase 1). The dev-mode/real-Vite asymmetry was a flagged, to-be-closed gap (hmr-bridge.ts header). Closing it executes ADR-0017's recorded direction; the only new surface is *how* the example dev server exposes its HMR transport.

## Decision
Make the example dev server's HMR transport **pluggable**, and have the playground route dev mode through the same bridge real-Vite uses.

- `@rifty-examples/vite-like-dev` `DevServerOptions` gains an optional `hmr?: HmrTransport` (`{ broadcast(payload: string): void; clientScript: string }`). When provided, served HTML embeds `hmr.clientScript` (instead of the built-in native-WS client) and file changes also broadcast through `hmr.broadcast`. Omitted → the built-in same-realm WS path is byte-for-byte unchanged.
- `startDevMode` (`apps/playground/src/glue/devMode.ts`) creates `setupHmrBridge({ port })` and passes `{ broadcast, clientScript: <hmrClientScript(port)> }`; tears the bridge down on `close()`.

## Options considered
- **(a) Duplicate the watcher in `devMode` + inject the bridge client via the seeded HTML.** No example change, but leaves the example's dead native-WS client firing connection errors in the iframe, and runs two watchers over the same tree. Rejected.
- **(b) Pluggable `hmr` transport on the example (chosen).** One watcher, the example stays self-contained and standalone-usable, the default path is unchanged, and the playground reuses the exact real-Vite bridge wiring. Additive, backward-compatible.
- **(c) Move dev mode into a Worker realm now (A-026).** Eventually unifies transports for free, but is a much larger M11 migration — premature just to make dev preview live. Deferred.

## Consequences
- Dev-mode preview is live: editor edit → `fs.watch` → bridge broadcast → iframe `BroadcastChannel` client → reload. Verified live in-browser (iframe auto-reloaded with new content; bridge `{type:'update'}` observed; no native-WS client injected in the dev iframe).
- Cross-package public API addition: the example's `DevServerOptions` gains an optional field (IRREVERSIBLE per the reversibility checklist item 1). Backward-compatible — existing callers/tests that omit `hmr` are unaffected.
- Both HMR consumers (dev + real-Vite) now share one transport, so the M11 A-026 Vite-in-Worker migration becomes a realm swap, not a routing rewrite.
- The built-in native-WS path is retained for standalone use of the example outside the playground.
- Naive HMR only (`{type:'update'}` → full reload); real ESM module-graph HMR remains out of scope (ADR-0017).

## Reversibility classification
**IRREVERSIBLE** — adds cross-package public API (`DevServerOptions.hmr`) and selects a mechanism among live alternatives. Executes ADR-0017's recorded bridge direction; does not contradict it. Recorded as this inline ADR.

## Acceptance
- [x] Dev edit triggers an automatic iframe reload with the new content (verified live).
- [x] The dev preview iframe loads the bridge client (`script[data-rifty-hmr-bridge]`) and NOT the native-WS client.
- [x] `DevServerOptions.hmr` is optional; omitting it keeps the example's built-in WS path unchanged.
- [x] `setupHmrBridge` is torn down on `startDevMode().close()`.
- [x] typecheck / lint / check:deps / unit / parity green.
