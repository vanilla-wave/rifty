/**
 * Shared wire-format constants and message-shape types between the main thread
 * (`@riftydev/service-worker` host) and the Service Worker script (`sw.ts`).
 *
 * ADR-0016 keeps the SW source in TypeScript and bundles it for the host.
 * ADR-0031 mandates per-frame version validation: every wire frame carries the
 * versions; the receiver refuses to honour a mismatched peer.
 * ADR-0040 splits versioning into two orthogonal contracts:
 *   - `SW_FRAME_VERSION` — wire-frame data shapes (this module).
 *   - `SW_ROUTING_VERSION` — addressing scheme (in `@riftydev/io/preview-protocol`),
 *     preview-frame port context (ADR-0097), and owner routing / fallback rules
 *     in the owner bindings.
 * Both must match for a peer to be accepted. A mismatch on either side
 * triggers the same `PROTOCOL_VERSION_MISMATCH` path with both `(expected,
 * got)` pairs in the diagnostic so the host can distinguish frame-skew from
 * routing-skew.
 */

/**
 * Wire-frame data version. Stamped onto every outgoing frame and validated
 * by the receiver at decode time. Pins the shape of every interface in this
 * module — {@link SwPingFrame}, {@link SwPongFrame},
 * {@link SwPreviewReadyFrame}, {@link SwPreviewGoodbyeFrame}, the
 * `SW_PREVIEW_REQUEST` envelope, {@link SerializedRequest},
 * {@link SerializedResponse}.
 *
 * Bump on: any change to a frame's field set, field type, or per-field
 * semantics. Additive optional fields with a documented default do NOT
 * require a bump — receiver treats `undefined` as the default (ADR-0031
 * SemVer-major rule, frame side).
 *
 * Does NOT cover the URL convention (`/preview/<port>/...`) or the
 * synthetic `preview.local` host — those are pinned by
 * {@link SW_ROUTING_VERSION} (they live in `@riftydev/io/preview-protocol`).
 */
export const SW_FRAME_VERSION = '1';

/**
 * Addressing-scheme and owner-routing version. Stamped alongside
 * {@link SW_FRAME_VERSION} on every wire frame; receivers validate both.
 *
 * Pins:
 *   - The URL convention exported from `@riftydev/io/preview-protocol`:
 *     `PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`, the shape of
 *     `synthesizePreviewUrl(path)`, and the shape of `parsePreviewPath`.
 *   - The owner-fallback and owner-scoping rules in the preview owner bindings:
 *     prefer `FetchEvent.clientId`, fall back to a controlled window, prefer an
 *     already-ready window for no-clientId copied preview URLs, and let Worker
 *     owners win either when `(ownerToken, port)` matches the controlling
 *     window or when a copied top-level preview URL has exactly one live Worker
 *     owner for that port. The warn/mismatch dedup key shapes are part of the
 *     contract.
 *   - Preview-frame port context in `./preview-bridge.ts` (ADR-0097): once an
 *     iframe commits `/preview/<port>/`, same-origin root requests from that
 *     iframe's `FetchEvent.clientId` (or same-origin `/preview/<port>/`
 *     referrer / `Client.url` after reload) route to the same port.
 *
 * Bump on: changes to the URL regex shape, the synthetic host literal, the
 * `synthesizePreviewUrl` return shape, the resolver fallback order, the Worker
 * claim scope, the preview-frame port context, or the mismatch /
 * first-window-warn dedup key shape.
 *
 * Does NOT cover wire-frame data shapes — those are pinned by
 * {@link SW_FRAME_VERSION}.
 */
export const SW_ROUTING_VERSION = '3';

export const SW_PING = '__rifty_sw_ping__';
export const SW_PONG = '__rifty_sw_pong__';
export const SW_PREVIEW_READY = 'rifty:preview:ready';
export const SW_PREVIEW_GOODBYE = 'rifty:preview:goodbye';
export const SW_PREVIEW_REQUEST = 'rifty:preview:request';

/** Discriminator constant for the SW→client request frame. */
export type SwPreviewRequestType = typeof SW_PREVIEW_REQUEST;

/** Ping/pong handshake frame — used for SW liveness checks. */
export interface SwPingFrame {
  type: typeof SW_PING;
  frameVersion: string;
  routingVersion: string;
}

export interface SwPongFrame {
  type: typeof SW_PONG;
  frameVersion: string;
  routingVersion: string;
  from: 'service-worker';
}

/**
 * Sent by the controlled window when its preview-bridge is subscribed and
 * ready to handle `/preview/<port>/*` fetches. Until the SW sees this frame
 * from a client, fetches for that client wait (bounded by a timeout).
 */
export interface SwPreviewReadyFrame {
  type: typeof SW_PREVIEW_READY;
  frameVersion: string;
  routingVersion: string;
  ports?: number[];
  ownerToken?: string;
}

/**
 * Sent on `pagehide`/`beforeunload` from the main thread, or detected by the
 * SW via `controllerchange`, to drop the client from the ready set so future
 * fetches don't hang on a defunct client.
 */
export interface SwPreviewGoodbyeFrame {
  type: typeof SW_PREVIEW_GOODBYE;
  frameVersion: string;
  routingVersion: string;
  ports?: number[];
  ownerToken?: string;
}

/**
 * SW→client request frame payload (the actual HTTP-ish request data, sibling
 * of the wire-envelope fields like `type`/`frameVersion`/`routingVersion`/
 * `requestId`).
 */
export interface SerializedRequest {
  port: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | null;
}

/**
 * client→SW response frame payload, sent over the reply `MessagePort`
 * attached to the request. `body` can be a transferable `ReadableStream`
 * (zero-copy on browsers that support it), a `Uint8Array` (drained-into-
 * memory fallback for older Safari / Workers), or `null` for empty bodies.
 *
 * Lives here alongside {@link SerializedRequest} because the request/response
 * pair forms one wire contract; `body-transport.ts` re-exports it through
 * {@link preview-bridge.ts} so the bundling-time version stamping can stay
 * with the transport helpers.
 */
export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: ReadableStream<Uint8Array> | Uint8Array | null;
}

/**
 * Discriminator for the protocol-version-mismatch error posted from the main
 * thread back to the SW when it receives a {@link SW_PREVIEW_REQUEST} frame
 * whose `frameVersion` or `routingVersion` does not match the expected pair.
 * The SW maps this to a 503 response (ADR-0031, refined by ADR-0040).
 */
export const SW_ERROR_PROTOCOL_VERSION_MISMATCH = 'PROTOCOL_VERSION_MISMATCH';

/**
 * Structured error returned by the main-thread bridge when a peer frame
 * carries a `frameVersion` or `routingVersion` that does not match the local
 * expected pair. Receivers should map this to a 503 ("protocol version
 * mismatch") response.
 *
 * ADR-0031 / ADR-0040 — every wire frame between the SW and the main thread
 * carries both versions; the receiver validates at decode time and refuses
 * to act on a mismatched peer. The `expected` and `got` pairs let the host
 * distinguish frame-skew (likely fresh SW + stale page) from routing-skew
 * (likely misconfigured `@riftydev/io` import).
 */
export interface SwProtocolVersionMismatchError {
  kind: typeof SW_ERROR_PROTOCOL_VERSION_MISMATCH;
  expected: { frame: string; routing: string };
  got: { frame: string; routing: string };
  message: string;
}
