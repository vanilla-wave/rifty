# @rifty/service-worker

Service Worker source + main-thread registration helpers + the wire protocol
that ties the two sides together.

The SW source-of-truth lives here in TypeScript (ADR-0016) and is bundled into
`apps/playground/public/sw.js` by `apps/playground/build/sw-plugin.ts` at dev
and build time; the package itself never publishes the generated JS.

## What lives here

### Preview routing — `/preview/<port>/...`

The SW intercepts `/preview/<port>/...` fetches in the controlled page and
forwards them to whichever realm owns the registered `@rifty/net` listener on
that port. Today the owner is the first controlled window client; once the
M11 worker-as-process model lands (ADR-0011) the resolver swaps to a
Worker-aware variant that consults the cross-realm port registry.

- URL convention + `preview.local` synthetic host: `@rifty/io/preview-protocol`,
  ADR-0036.
- SW-side wiring: `installPreviewInterceptor(self)` in `sw.ts` /
  `preview-bridge.ts`.
- Main-side wiring: `setupPreviewBridge(handler)` posts the
  `rifty:preview:ready` frame on init and `goodbye` on teardown.
- Cross-realm scope statement: ADR-0017.

### Body-transport / streaming carrier

`packSerializedResponse` decides per-response whether to transfer the
`ReadableStream` body across `postMessage` (Chromium ≥ 89, Firefox ≥ 103,
Safari ≥ 16.4) or drain it into a `Uint8Array` first (older Safari, some
Workers). `canTransferReadableStream()` is the runtime probe; the result is
cached after the first call. The protocol-version stamp is added to the
packed message envelope.

### Owner resolver

`PreviewOwnerResolver` is the strategy that names the realm an intercepted
preview fetch should be forwarded to. `FirstWindowOwnerResolver` is the
default — prefers `FetchEvent.clientId` then falls back to the first
controlled window with a one-shot `console.warn`. M11's `WorkerOwnerResolver`
will replace the default once A-023 (SW → Worker port registry rewire) and
A-026 (Vite-in-Worker) land. See `owner-resolver.ts` for the seam and
ADR-0031 for the rationale.

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
`@rifty/io/preview-protocol` (`PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`,
`synthesizePreviewUrl`, `parsePreviewPath`) and (b) the owner-fallback
rules in `owner-resolver.ts` (`FirstWindowOwnerResolver`). Bumping
requires: changes to the URL regex shape, the synthetic host literal,
the resolver fallback order, or the mismatch / one-shot-warn dedup key
shape.

ADR-0040 is the source-of-truth for the split; ADR-0031 is the
predecessor that established the per-frame contract; ADR-0016 covers
the broader "TS source-of-truth + bundled `sw.js`" decision.

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
- ADR-0017 — `@rifty/net` cross-realm scope and the streaming rewrite that
  unblocks the body-transport upgrades scheduled for M12.
- ADR-0031 — per-frame `version` validation.
- ADR-0036 — preview-protocol addressing primitives live in `@rifty/io`.
- `REVIEW_ACTIONS.md` A-023 / A-026 — the M11 path that swaps the default
  owner resolver.
