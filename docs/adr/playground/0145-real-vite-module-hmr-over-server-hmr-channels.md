# ADR 0145: Real Vite module HMR over server.hmr.channels

Status: Accepted
Date: 2026-06-14

> TL;DR: real-Vite uses Vite's native HMR broadcaster over a rifty
> `server.hmr.channels` BroadcastChannel transport; the reload-only bridge is
> no longer the real-Vite update path.

## Context

The closed honest-Vite-HMR backlog item recorded the gap: real-Vite edits sent a
hand-rolled `{type:'update', path}` over `hmrClientScript`, whose only effect
was `location.reload()`. That satisfied "preview refreshes" but lost app state
and never exercised Vite's module graph HMR.

ADR-0017 deferred a general cross-realm WebSocket/TCP bridge to M12. That is
still true for arbitrary `WebSocket` users. Vite 5.4.21, however, exposes a
narrower seam: `server.hmr.channels`. A channel receives the same `HMRPayload`s
Vite sends to its built-in `ws` server, without requiring the browser iframe to
open a real socket to the worker realm.

## Decision

Real-Vite HMR is now:

1. Worker creates `createViteHmrBridgeChannel({ port, token })`, a structural
   Vite HMR channel backed by the existing tokenized
   `BridgedWebSocketServer`/`BroadcastChannel` carrier.
2. Worker starts Vite with `server.hmr = { channels: [channel], ... }` and
   `server.ws = false`. Vite's watcher and module graph now generate real
   `connected`, `update`, `full-reload`, `prune`, and `error` payloads; Vite's
   native `ws` server is not used.
3. `createHmrBridgeVitePlugin` injects `viteHmrClientScript` as a late
   `head-prepend` tag. The script installs a targeted `WebSocket` shim only for
   Vite's `"vite-hmr"` subprotocol, dispatches raw messages to `@vite/client`,
   and never interprets updates or calls `location.reload()`.
4. Page-to-worker editor writes trigger Vite's native watcher path (`emit`
   `'change'`) so Vite runs its own HMR update pipeline. The old manual
   `broadcastFileUpdate` payload is removed.
5. The Vite template and browser real-Vite preset entries are self-accepting by
   default, so the first seeded JS edit can patch in place. Vite still
   full-reloads non-HMR-able boundaries (HTML/config/non-accepted imports); the
   dark first-frame background remains useful for those fallback reloads.

## Consequences

- (+) Real-Vite JS edits preserve iframe state when the module is HMR-able.
- (+) The iframe still owns automatic refresh per ADR-0126; parent snapshot
  reload stays removed.
- (+) No new external dependency; `PREVIEW_LOCAL_HOST` now comes from
  `@riftydev/io`, closing the playground host-literal backlog item.
- (=) ADR-0017's general cross-realm WebSocket/TCP M12 work remains open for
  arbitrary sockets, SSE/streaming, and backpressure. This ADR is Vite-specific.
- (-) The transport still uses BroadcastChannel: no per-connection isolation or
  backpressure. Good enough for Vite HMR payloads; not a general socket answer.

## Acceptance

- [x] Unit coverage proves the Vite channel sends `connected` + real
  `update.updates[]` payloads and receives custom events.
- [x] Unit coverage proves the real-Vite injected script is a targeted
  `"vite-hmr"` WebSocket shim and contains no `location.reload()`.
- [x] Bootstrap coverage pins `server.hmr.channels`, `ws:false`, and removal of
  the fake `{type:'update', path}` broadcast.
- [x] Template and preset coverage pins self-accepting browser entries.
- [x] Browser e2e asserts an HMR-able edit changes DOM while a `globalThis`
  sentinel survives (opt-in `RIFTY_E2E_HMR=1`).
