# Changelog

## [Unreleased]

### Added

- `registerServiceWorker(scriptUrl, options)` helper for the host.
- `sw.ts` worker source: installs/activates, claims clients, responds to `__rifty_sw_ping__` for liveness.
- **M10:** Preview bridge — `installPreviewInterceptor(self)` matches `/preview/<port>/*` and forwards to the first window client over `MessageChannel`. `setupPreviewBridge(handler)` on the main thread answers with a serialised response. 3 URL-matcher unit tests.
- **M10 (handshake):** `rifty:preview:ready` / `rifty:preview:goodbye` handshake — `setupPreviewBridge` posts `ready` to `navigator.serviceWorker.controller` on init (and `goodbye` on teardown); the SW maintains a `Set<clientId>` of ready clients and queues `/preview/*` fetches until that client is ready or a configurable 3-second timeout elapses (`503 preview-bridge not ready within 3000ms` on timeout). Eliminates the cold-boot race that previously returned `503 No client`.
- **M10 (timeout & state):** `registerServiceWorker` accepts a `timeout` option (default 30 s); rejects with `service-worker activation timed out after Nms` or `service-worker became redundant during activation` instead of hanging forever on a stuck installation. Logs each `statechange` to console.
- **M10 (protocol version):** `SW_PROTOCOL_VERSION` (ADR-0016) is embedded in every wire frame (`ping`/`pong`/`preview:ready`/`preview:goodbye`/`preview:request` + response). On version mismatch the SW one-shot-warns and refuses with `503 protocol version mismatch`. Public exports for the new constants and types live in `@rifty/service-worker/protocol`.
- 6 SW-side + 2 main-side + 4 register unit tests cover handshake queue/dispatch/timeout/goodbye, version mismatch, redundant rejection, and timeout rejection.
