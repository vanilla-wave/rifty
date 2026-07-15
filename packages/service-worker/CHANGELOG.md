# Changelog

## [Unreleased]

### Changed

- **`SW_ROUTING_VERSION` 5 → 6:** the upstream URL the SW forwards for `/preview/<port>/*`
  now carries `Host: localhost:<port>` (was `preview.local:<port>`) — see
  `@riftydev/io` `synthesizePreviewUrl` (ADR-0189 D3). A stale SW + new page (or vice
  versa) 503s previews until reload, as the version stamp intends.

### Added

- **ADR-0160:** window owners advertise an additive-optional `ports` field on
  `rifty:preview:ready`/`goodbye`; falsy-clientId preview traffic resolves
  port-keyed over the READY windows owning the port — unique window → route,
  multiple → 503 (multi-window isolation, symmetric with ADR-0123's worker
  `(ownerToken, port)` scoping), a no-`ports` window keeps the legacy
  ready-window fallback (ADR-0125, back-compat). Real cross-tab preview: a
  copied `/preview/<port>/` tab resolves to the single window owning the port.

### Fixed

- **Service Worker control proof is attempt-correlated.** Each host PING now
  transfers a dedicated reply `MessagePort`; controller replacement, abort,
  timeout, and settlement close the old local port, so a delayed old PONG
  cannot prove the current controller attempt. Zero-port PING keeps the legacy
  source reply for older hosts.
- **Doc drift:** the `rifty:preview:ready` example frame in
  `owner-binding-worker.ts` now shows `routingVersion: '5'`, matching the bumped
  `SW_ROUTING_VERSION` constant (the runtime path was already correct; only the
  illustrative comment was stale).
- **ADR-0160:** port-scoped page bridges now refuse cross-port requests end to
  end. The SW no longer falls back to a ready window that advertised other
  ports, and `setupPreviewBridge({ ports })` ignores `rifty:preview:request`
  frames for ports outside that set. This prevents a live dev-server bridge
  from answering a later `vite preview` route during the small window before the
  production preview bridge announces readiness.
- **ADR-0160 (anti-hijack):** the SW rejects `rifty:preview:ready` from any
  client it has served a `/preview/<port>/` document to — a dedicated
  `previewDocumentClients` set pruned by LIVENESS (`clients.matchAll`), never
  insertion-evicted, so a live preview document is never dropped and cannot
  reclaim the bridge under churn. Keyed on the SW-served-navigation fact, not
  the mutable `client.url`, so `history.pushState` cannot defeat it. **Fully
  closes preview-owner-window-auth** (a previewed app self-registering as bridge
  owner), independent of the routing frame-context eviction policy. The
  COEP-on-error fix below is the third leg of ADR-0160.

### Changed

- **ADR-0160:** `SW_ROUTING_VERSION` `3`→`4` — window port-keying and the
  anti-hijack ready rejection are wire-observable routing rules.
  `SW_FRAME_VERSION` stays `1` (window `ports` is additive-optional). A stale
  peer 503s via the existing structured `(frame, routing)` mismatch (ADR-0040).

### Changed

- **ADR-0125 supersedes ADR-0046 (removed).** Records the previously
  unrecorded `SW_ROUTING_VERSION` `'3'` owner-selection decisions: async
  `FirstWindowOwnerBinding.resolveOwner` (microtask-timing invariant dropped —
  its fixed-turn rationale was stale), the ready-window preference for
  no-clientId fallback, and the clientId sentinel trichotomy (id / `''`
  anonymous-embedded / `null` copied-top-level). TSDoc across the owner
  bindings updated to cite ADR-0125 and document the sentinels; no behavior
  change.

### Fixed

- **Preview error responses (503/502) carry CORP+COEP (ADR-0160).** Every route-preview
  error path (no owner, version mismatch, owner gone, handshake timeout, reply
  protocol mismatch, reply error) now sets `Cross-Origin-Resource-Policy:
  cross-origin` + `Cross-Origin-Embedder-Policy: credentialless`, matching the
  success path. Without them a foreign tab embedding the preview under page COEP
  credentialless (D-001) saw `ERR_BLOCKED_BY_RESPONSE` instead of an honest
  error page.
- **Preview requests preserve the target port in synthetic upstream URLs.**
  `synthesizePreviewUrl(path, port)` now lets the SW serialise
  `http://preview.local:<port>/...`, so Node HTTP adapters deriving
  `Request.url` from `Host` see the same preview target the route matched.
  `SW_ROUTING_VERSION` bumps to `5`.

- **SSE bodies fail loud in no-transferable-stream realms.**
  `packSerializedResponse` now refuses to drain `text/event-stream` bodies when
  `ReadableStream` transfer over `postMessage` is unavailable, throwing
  `NotImplementedError('service-worker.preview.sse-drain-fallback')` instead of
  hanging forever on an unending SSE response. The throw is caught by the bridge
  and surfaces to the preview `fetch` as an HTTP 502 carrying that message.
- **Serialized POSTs advertise `content-length`** derived from the drained
  body bytes (fetch Request headers never expose it) — without it, worker-side
  body parsers (express.json's typeis `hasBody()`) silently skipped bodies
  (ADR-0130 fullstack demo).

- **Preview bridge readiness survives Service Worker global restarts.**
  `setupPreviewBridge` now re-advertises `rifty:preview:ready` on
  `controllerchange` and on a small heartbeat while mounted, so a browser-idled
  SW global can rebuild its in-memory ready registry instead of timing out a
  still-running preview later. Teardown clears the heartbeat and posts goodbye.
- **Preview iframe navigation commits in-frame (ADR-0074, applied on this
  branch).** The preview interceptor now routes every request originating
  inside the preview `<iframe>` — the document navigation (`request.mode ===
  'navigate'`) and its subresources (non-empty `request.destination`) — to the
  controlling window that owns the port (`clientId = null` → first-controlled-
  window fallback), keeping `resultingClientId || clientId` only for the page's
  own bare `fetch` warm-up. Without this the readiness handshake targeted the
  iframe's own client (which runs no `setupPreviewBridge`), timed out, and the
  navigation aborted (`net::ERR_ABORTED`) so the live preview never rendered.
  This branch bumps `SW_ROUTING_VERSION` through `'3'` together with ADR-0123's
  owner-scoped Worker routing and copied top-level preview fallback refinement,
  so stale peers fail loudly instead of silently disagreeing on owner selection.
- **Preview iframe root-relative requests route to the iframe's preview port
  (ADR-0097).** After a preview iframe commits `/preview/<port>/`, the SW records
  the iframe client id as owning that port and routes same-origin root requests
  from that client (`/src/main.js`, `/@vite/client`, lazy chunks,
  `fetch('/api')`, SPA navigations) through the same preview owner. Unknown
  page-root requests now fall through without `respondWith`; reload recovery is
  limited to known iframe context or a same-origin `/preview/<port>/` referrer,
  so ordinary playground assets are not proxied through the SW and page-owned
  `/preview/...` subresources do not poison the page client context. Cross-port
  preview subrequests route only that explicit request and do not rebind the
  iframe's root-relative context. This keeps real Vite apps working without
  rewriting their HTML to relative paths. This rides on the same
  `SW_ROUTING_VERSION` contract as ADR-0123.
- **Copied top-level preview URLs resolve when the port has a single Worker
  owner.** Opening `/preview/<port>/` outside the playground shell has no
  iframe parent client and may enumerate the new preview tab before the
  playground shell, so the no-clientId window fallback now prefers an
  already-ready window. `PortAwareOwnerBinding` also uses a direct Worker
  fallback only when exactly one live Worker claims that port. If multiple
  playground windows claim the same port under different owner tokens, the SW
  keeps refusing to guess, preserving ADR-0123 isolation. `SW_ROUTING_VERSION`
  bumps to `3` because owner-fallback order changed.

### Added

- **ADR-0123:** `PortAwareOwnerBinding` becomes the default owner binding for
  `createPreviewInterceptor`: the controlling window advertises `ownerToken`,
  Workers claim `(ownerToken, port)` via `ports: [...]`, and only matching
  Worker claims win; unclaimed ports fall back to the historical window bridge.
  New public exports: `PortAwareOwnerBinding`, `PortAwareOwnerBindingOptions`,
  and `PreviewBridgeOptions`; `setupPreviewBridge` can now advertise `ownerToken`
  and `ports` on ready/goodbye frames. `SW_FRAME_VERSION` stays `1` because the
  fields are additive optional; `SW_ROUTING_VERSION` first bumps to `2` because
  owner selection semantics changed, and the copied top-level preview fallback
  refinement above bumps the same contract to `3`.
- **ADR-0046 (A-023):** `PreviewOwnerBinding` — one seam the preview
  interceptor sits on top of, designed from both the window and worker
  owners at once (promotes OPEN_QUESTIONS Q-2026-05-27-002). New
  exports: `PreviewOwnerBinding`, `ReadinessSignal`,
  `ReadinessSubscription`, `ReadinessOutcome` (now includes `'gone'`),
  `FirstWindowOwnerBinding` (+`FirstWindowOwnerBindingOptions`),
  `WorkerOwnerBinding` (+`WorkerOwnerBindingOptions`,
  `WorkerOwnerBindingLogger`). `createPreviewInterceptor` resolves
  owners and gates readiness THROUGH the binding; ADR-0123 later makes the
  default port-aware and owner-scoped. The worker binding routes by
  `(ownerToken, port)` (a Worker-served preview fetch has no DOM
  `clientId` of its own), re-validates the owner via `clients.get`, and surfaces
  the new `'gone'` outcome for the no-`pagehide` worker lifecycle
  (Worker terminated without a goodbye) so `route-preview` returns a
  precise 503 instead of hanging to timeout. The worker readiness
  frame's `ports: number[]` field is additive optional; ADR-0123 adds the
  routing-version bump when those claims become owner-scoped.
  The legacy `FirstWindowOwnerResolver` / `PreviewOwnerResolver`
  surface and the `hooks.resolver` shortcut stay for back-compat. New
  dual-strategy parity test (`tests/preview-owner-binding-parity.test.ts`)
  plus worker-specific lifecycle cases (silent death, port handover,
  multi-port routing, ready-without-ports).
- `console.error('[rifty/service-worker] …')` breadcrumbs on every
  `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` mismatch path that previously
  produced only a structured 503 carrier (`preview-bridge.ts` incoming
  request, `route-preview.ts` reply error). Mirrors the `console.warn`
  already emitted by `ready-clients.ts` on handshake drift so version
  bumps surface in DevTools without inspecting the 503 body. Follow-up
  to the 2026-05-27 architecture review (`docs/follow-ups-architecture-review-2026-05-27.md` item #5).

### Changed

- **ADR-0040 (BREAKING):** protocol versioning split into two constants —
  `SW_FRAME_VERSION` (wire-frame data shapes) and `SW_ROUTING_VERSION`
  (addressing scheme from `@riftydev/io/preview-protocol` + owner-fallback
  rules from `owner-resolver.ts`). The legacy `SW_PROTOCOL_VERSION`
  constant is removed; the only in-repo consumer was the SW package
  itself, and the comments in `kernel/sync-rpc.ts` reference the old
  name in prose (rewritten to cite ADR-0040). Every wire frame now
  carries both `frameVersion` and `routingVersion` fields (renamed from
  the previous single `version` field). The mismatch error grows two
  `(expected, got)` pairs so the host can distinguish frame-skew from
  routing-skew. Mismatch on EITHER contract triggers the existing
  `PROTOCOL_VERSION_MISMATCH` → HTTP 503 path; the warning lists which
  contract drifted by name. New public exports: `SW_FRAME_VERSION`,
  `SW_ROUTING_VERSION`. Removed: `SW_PROTOCOL_VERSION`. Two new tests
  pin the routing-only-mismatch and frame-only-mismatch paths
  end-to-end.

### Added

- **M7 acceptance coverage:** `tests/e2e/m7-preview-sw.spec.ts` exercises
  the full `installPreviewInterceptor` → resolved-client `postMessage` →
  bridge handler reply → `packSerializedResponse` carrier path in a real
  browser. The playground page boots, the SW takes control, "Dev Mode"
  starts an `@riftydev/net` HTTP server on port 3000, and a
  `fetch('/preview/3000/')` is asserted to round-trip with the registered
  handler's HTML body. Closes the e2e gap that the unit tests in
  `tests/preview-handshake-sw.test.ts` and the integration smoke in
  `tests/integration/express-style.test.ts` cannot reach (the former
  mocks `MessageChannel`; the latter bypasses the bridge entirely).

### Changed

- **ADR-0036:** preview-protocol addressing (`/preview/<port>/...` URL
  scheme + `preview.local` synthetic host) now imported from `@riftydev/io`
  instead of inlined. `preview-bridge.ts` drops its private
  `PREVIEW_PREFIX_RE` constant; `matchPreviewUrl` is now a thin
  shape-adapter over `@riftydev/io.parsePreviewPath` (preserves the
  `{port, path}` shape SW callers use). `route-preview.ts` calls
  `synthesizePreviewUrl(match.path)` instead of building
  `http://preview.local${...}` inline. `package.json` gains
  `@riftydev/io: workspace:*` (was zero workspace deps). Wire-frame
  behaviour unchanged — this is a pure addressing-primitive refactor;
  ADR-0031 versioning is orthogonal.

### Added

- `registerServiceWorker(scriptUrl, options)` helper for the host.
- `sw.ts` worker source: installs/activates, claims clients, responds to `__rifty_sw_ping__` for liveness.
- **M10:** Preview bridge — `installPreviewInterceptor(self)` matches `/preview/<port>/*` and forwards to the first window client over `MessageChannel`. `setupPreviewBridge(handler)` on the main thread answers with a serialised response. 3 URL-matcher unit tests.
- **M10 (handshake):** `rifty:preview:ready` / `rifty:preview:goodbye` handshake — `setupPreviewBridge` posts `ready` to `navigator.serviceWorker.controller` on init (and `goodbye` on teardown); the SW maintains a `Set<clientId>` of ready clients and queues `/preview/*` fetches until that client is ready or a configurable 3-second timeout elapses (`503 preview-bridge not ready within 3000ms` on timeout). Eliminates the cold-boot race that previously returned `503 No client`.
- **M10 (timeout & state):** `registerServiceWorker` accepts a `timeout` option (default 30 s); rejects with `service-worker activation timed out after Nms` or `service-worker became redundant during activation` instead of hanging forever on a stuck installation. Logs each `statechange` to console.
- **M10 (protocol version):** `SW_PROTOCOL_VERSION` (ADR-0016) is embedded in every wire frame (`ping`/`pong`/`preview:ready`/`preview:goodbye`/`preview:request` + response). On version mismatch the SW one-shot-warns and refuses with `503 protocol version mismatch`. Public exports for the new constants and types live in `@riftydev/service-worker/protocol`.
- 6 SW-side + 2 main-side + 4 register unit tests cover handshake queue/dispatch/timeout/goodbye, version mismatch, redundant rejection, and timeout rejection.
- **M10 (ADR-0031):** main-thread `setupPreviewBridge` now validates `data.version === SW_PROTOCOL_VERSION` on every incoming `SW_PREVIEW_REQUEST` frame, refusing mismatched frames with a structured `{ kind: 'PROTOCOL_VERSION_MISMATCH', expected, got, message }` error and never calling the user handler. The SW maps that error back to `HTTP/503`. New exports: `SW_ERROR_PROTOCOL_VERSION_MISMATCH`, `SwProtocolVersionMismatchError`, and `SerializedRequest` (now lives in `protocol.ts`, re-exported from the bridge for back-compat).
- **M10 (ADR-0031):** SW-side `/preview/*` routing now uses `event.resultingClientId || event.clientId` to look up the owning window via `clients.get(id)` — fixes silent misroutes in multi-window pages where `clients.matchAll()[0]` was not the request's owner. Falls back to the legacy `matchAll()[0]` path only when both ids are empty (navigation-preload edge case); the fallback emits a one-shot `console.warn` per SW scope. SW routing logic split out of `preview-bridge.ts` into `route-preview.ts` to stay under the ADR-0024 file-size budget.
- 1 new SW-side test asserts `event.clientId` routing in the presence of two ready clients; 1 new main-side test asserts mismatched-version request rejection with the typed error frame and no user-handler invocation.
- **M10 (D-G / A-023 prep):** `PreviewOwnerResolver` strategy extracted from `route-preview.ts` into `owner-resolver.ts`. The default `FirstWindowOwnerResolver` carries the M10 first-window logic verbatim — no behaviour change. `createPreviewInterceptor` accepts an optional `resolver` hook; the M11 A-026 (Vite-in-Worker) + A-023 (SW→Worker registry) migration becomes a one-line swap to a `WorkerOwnerResolver` instead of a fork of the routing pipeline. New public exports: `FirstWindowOwnerResolver`, `PreviewOwnerResolver`. 5 new tests pin both the default behaviour and the seam shape (custom resolver returning a non-window client is honoured by `routePreview`).

### Changed

- `SerializedResponse` interface moved from `body-transport.ts` to `protocol.ts` — both halves of the wire pair now live with the other protocol types. `body-transport.ts` re-exports it for back-compat; `preview-bridge.ts` re-exports it from `protocol.ts` directly. No external API change — `@riftydev/service-worker` continues to export `SerializedResponse`.
- Wire-format JSDoc in `preview-bridge.ts` clarified to reflect the actual `sw→client` request frame shape (`{ type, version, requestId, request: { … } }`) and explicitly cites ADR-0031's mandatory `version` field on every data frame.
