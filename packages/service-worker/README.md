# @riftydev/service-worker

Service Worker source + main-thread registration helpers + the wire protocol
that ties the two sides together.

The SW source-of-truth lives here in TypeScript (ADR-0016) and is bundled into
`apps/playground/public/sw.js` by `apps/playground/build/sw-plugin.ts` at dev
and build time; the package itself never publishes the generated JS.

## What lives here

### Preview routing — `/preview/<port>/...`

The SW intercepts `/preview/<port>/...` fetches in the controlled page and
forwards them to whichever realm owns the registered `@riftydev/net` listener on
that port. The default owner binding is port-aware (ADR-0123): a Worker client
that announces the controlling window's `ownerToken` plus `ports: [port]` wins,
otherwise routing falls back to the historical first controlled window bridge.

- URL convention + `preview.local` synthetic host: `@riftydev/io/preview-protocol`,
  ADR-0036.
- SW-side wiring: `installPreviewInterceptor(self)` in `sw.ts` /
  `preview-bridge.ts`.
- Main-side wiring: `setupPreviewBridge(handler)` posts the
  `rifty:preview:ready` frame on init, `controllerchange`, and heartbeat;
  teardown posts `rifty:preview:goodbye`.
- Cross-realm scope statement: ADR-0017.

### Body-transport / streaming carrier

`packSerializedResponse` decides per-response whether to transfer the
`ReadableStream` body across `postMessage` (Chromium ≥ 89, Firefox ≥ 103,
Safari ≥ 16.4) or drain it into a `Uint8Array` first (older Safari, some
Workers). `canTransferReadableStream()` is the runtime probe; the result is
cached after the first call. The protocol-version stamp is added to the
packed message envelope.

### Owner binding / resolver

`PreviewOwnerBinding` is the strategy that names the realm an intercepted
preview fetch should be forwarded to and gates readiness before dispatch.
`PortAwareOwnerBinding` is the default: it resolves the controlling window
first, reads that window's `ownerToken`, asks `WorkerOwnerBinding` for a Worker
that claimed the matching `(ownerToken, port)`, then falls back to
`FirstWindowOwnerBinding` for page-owned previews. `FirstWindowOwnerResolver`
still documents the historical window path: prefer `FetchEvent.clientId`, then
fall back to a controlled window with a one-shot `console.warn`. When the first
fallback candidate is not ready, the binding prefers an already-ready window so a
copied top-level preview tab does not steal its own preview request from the
playground shell. See `owner-resolver.ts` and ADR-0031 for the fallback
rationale.

Copied top-level preview URLs (`/preview/<port>/` opened outside the playground
shell) may have no controlling window owner token, or the browser may enumerate
the new preview tab before the playground shell. For that case, the window
binding prefers a ready playground window; the default binding may also route
directly to a Worker when exactly one live Worker claims the requested port. If
multiple Workers claim the same port under different owner tokens, the URL is
ambiguous and the SW refuses to pick a winner, preserving ADR-0123 multi-window
isolation.

### Ready-clients registry / handshake

`createReadyClientsRegistry` maintains the per-`clientId` ready/mismatched
state machine used to gate preview fetches. A fetch for a not-yet-ready
client waits in `waitForReady(id, timeoutMs)` until the client posts
`rifty:preview:ready`, the client posts `rifty:preview:goodbye`, the wait
times out, or the client posts a mismatched protocol version (failed
`mark` waiters resolve with `'mismatch'`/`'timeout'`). Default ready timeout
is `DEFAULT_READY_TIMEOUT_MS = 3_000`; on timeout the SW returns
`503 preview-bridge not ready within Nms`.

### `SW_FRAME_VERSION` + `SW_ROUTING_VERSION` on every wire frame

Every frame across `postMessage` between the SW and the controlling page
carries TWO version fields: `frameVersion: string` (set to
`SW_FRAME_VERSION`) and `routingVersion: string` (set to
`SW_ROUTING_VERSION`). Receivers MUST validate both at decode time before
any side effect; mismatch on either contract → 503 ("protocol version
mismatch") and a one-shot `console.warn` per peer that names the drifted
contract.

`SW_FRAME_VERSION` pins wire-frame data shapes (`SwPingFrame`,
`SwPongFrame`, `SwPreviewReadyFrame`, `SwPreviewGoodbyeFrame`, the
`SW_PREVIEW_REQUEST` envelope, `SerializedRequest`, `SerializedResponse`).
Bumping requires: changes to any frame's field set, field type, or
per-field semantics.

`SW_ROUTING_VERSION` pins (a) the addressing scheme exported from
`@riftydev/io/preview-protocol` (`PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`,
`synthesizePreviewUrl`, `parsePreviewPath`), (b) the preview-frame port
context that routes root-relative iframe requests to the same preview port
by iframe `clientId` or same-origin `/preview/<port>/` request referrer, and
(c) the owner-fallback and owner-scoping rules in the
preview owner bindings, including the unambiguous Worker fallback for copied
top-level preview URLs and the ready-window preference for no-clientId fallback.
Bumping requires: changes to the URL regex shape, the synthetic host literal,
the preview-frame port-context rule, the resolver fallback order, the Worker
claim scope, or the mismatch / one-shot-warn dedup key shape.

ADR-0040 is the source-of-truth for the split; ADR-0031 is the
predecessor that established the per-frame contract; ADR-0016 covers
the broader "TS source-of-truth + bundled `sw.js`" decision. ADR-0097 records
the preview-frame root-relative routing contract and the bump to
`SW_ROUTING_VERSION` `'3'`; ADR-0123 records the `'2'` owner-scoped Worker
routing bump; ADR-0125 records the ready-window preference, async owner
resolution, and the clientId sentinel trichotomy.

The protocol does not attempt cross-version compatibility — a version
mismatch between an old page and a fresh SW (or vice-versa) refuses
both ways. The structured mismatch error includes both `(expected,
got)` pairs so a host can distinguish frame-skew from routing-skew.

### Registration helper

`registerServiceWorker(scriptUrl, options)` wraps `navigator.serviceWorker
.register` with `statechange` logging, a configurable activation timeout
(default 30 s), and proper rejection on the `redundant` transition.

## See also

- ADR-0011 — kernel + worker-as-process model (M11 prerequisite for the
  Worker-aware owner resolver).
- ADR-0016 — SW source-of-truth in TypeScript.
- ADR-0017 — `@riftydev/net` cross-realm scope and the streaming rewrite that
  unblocks the body-transport upgrades scheduled for M12.
- ADR-0031 — per-frame `version` validation.
- ADR-0036 — preview-protocol addressing primitives live in `@riftydev/io`.
- ADR-0123 — port-aware preview owner routing: Worker-owned `(ownerToken, port)`
  routes go directly SW→Worker, while page-owned previews keep the first-window
  fallback.
