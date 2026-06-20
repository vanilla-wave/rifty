# ADR 0145: Real Vite module HMR

Status: Accepted (corrected by ADR-0147, ADR-0151, and ADR-0161)
Date: 2026-06-14

> Correction 2026-06-20: ADR-0161 scopes the Vite 8 template default — HMR is
> DISABLED there until the native socket/`server.ws` path is re-proven against
> Rolldown's WASI worker pool. This ADR's "Vite owns HMR over the browser
> WebSocket bridge" architecture still stands; only the Vite 8 default-on scope
> is superseded (transport corrections to ADR-0147/0151 are already in Context).

## Context

Real-Vite edits used to send a hand-rolled `{type:'update', path}` payload to a
reload-only client. That made the preview change, but it was not Vite HMR:
module graph invalidation, `update.updates[]`, `prune`, `error`, and app-state
preservation were bypassed.

The first accepted implementation used Vite 5.4's `server.hmr.channels` seam to
get real Vite payloads without a general HTTP WebSocket upgrade path. That seam
is now superseded:

- ADR-0147 replaced the Vite-only browser socket patch with the generic
  configured-host `window.WebSocket` bridge.
- ADR-0151 made `http.Server.on('upgrade')` work over that bridge, so Real-Vite
  can use Vite's native `server.ws` path instead of `server.hmr.channels`.

## Decision

Real-Vite HMR must be Vite-owned, not rifty-synthesized:

- Vite's watcher/module graph generates `connected`, `update`, `full-reload`,
  `prune`, and `error` payloads.
- Page-to-worker editor writes wake Vite's native watcher path.
- `createHmrBridgeVitePlugin` injects the generic `@riftydev/net` browser
  WebSocket bridge before `/@vite/client`.
- Current transport is ADR-0151: Vite native `server.ws` attaches to rifty
  `http.Server.on('upgrade')`. The old `server.hmr.channels` adapter and
  `ws:false` config are not part of the current design.

## Consequences

- (+) HMR-able JS edits preserve iframe state.
- (+) Vite remains the source of HMR semantics; rifty only supplies the browser
  socket/HTTP-upgrade substrate.
- (=) Vite can still full-reload non-HMR-able boundaries.
- (=) Raw TCP/TLS sockets remain ADR-0017 boundaries.

## Acceptance

- [x] Browser bridge injection is idempotent and contains no reload-only Vite
  shim.
- [x] Bootstrap coverage rejects the old `server.hmr.channels`/`ws:false`
  config path.
- [x] Integration coverage starts real Vite against rifty HTTP WebSocket
  upgrade, emits a watcher change, and sees Vite-generated `update.updates[]`
  without `full-reload`.
- [x] Browser e2e asserts an HMR-able edit changes DOM while a `globalThis`
  sentinel survives (opt-in `RIFTY_E2E_HMR=1`).
