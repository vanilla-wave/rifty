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
- **M10 (ADR-0031):** main-thread `setupPreviewBridge` now validates `data.version === SW_PROTOCOL_VERSION` on every incoming `SW_PREVIEW_REQUEST` frame, refusing mismatched frames with a structured `{ kind: 'PROTOCOL_VERSION_MISMATCH', expected, got, message }` error and never calling the user handler. The SW maps that error back to `HTTP/503`. New exports: `SW_ERROR_PROTOCOL_VERSION_MISMATCH`, `SwProtocolVersionMismatchError`, and `SerializedRequest` (now lives in `protocol.ts`, re-exported from the bridge for back-compat).
- **M10 (ADR-0031):** SW-side `/preview/*` routing now uses `event.resultingClientId || event.clientId` to look up the owning window via `clients.get(id)` — fixes silent misroutes in multi-window pages where `clients.matchAll()[0]` was not the request's owner. Falls back to the legacy `matchAll()[0]` path only when both ids are empty (navigation-preload edge case); the fallback emits a one-shot `console.warn` per SW scope. SW routing logic split out of `preview-bridge.ts` into `route-preview.ts` to stay under the ADR-0024 file-size budget.
- 1 new SW-side test asserts `event.clientId` routing in the presence of two ready clients; 1 new main-side test asserts mismatched-version request rejection with the typed error frame and no user-handler invocation.
- **M10 (D-G / A-023 prep):** `PreviewOwnerResolver` strategy extracted from `route-preview.ts` into `owner-resolver.ts`. The default `FirstWindowOwnerResolver` carries the M10 first-window logic verbatim — no behaviour change. `createPreviewInterceptor` accepts an optional `resolver` hook; the M11 A-026 (Vite-in-Worker) + A-023 (SW→Worker registry) migration becomes a one-line swap to a `WorkerOwnerResolver` instead of a fork of the routing pipeline. New public exports: `FirstWindowOwnerResolver`, `PreviewOwnerResolver`. 5 new tests pin both the default behaviour and the seam shape (custom resolver returning a non-window client is honoured by `routePreview`).

### Changed

- `SerializedResponse` interface moved from `body-transport.ts` to `protocol.ts` — both halves of the wire pair now live with the other protocol types. `body-transport.ts` re-exports it for back-compat; `preview-bridge.ts` re-exports it from `protocol.ts` directly. No external API change — `@rifty/service-worker` continues to export `SerializedResponse`.
- Wire-format JSDoc in `preview-bridge.ts` clarified to reflect the actual `sw→client` request frame shape (`{ type, version, requestId, request: { … } }`) and explicitly cites ADR-0031's mandatory `version` field on every data frame.
