/**
 * Shared wire-format constants and message-shape types between the main thread
 * (`@rifty/service-worker` host) and the Service Worker script (`sw.ts`).
 *
 * ADR-0016 keeps the SW source in TypeScript and bundles it for the host.
 * Pinning the protocol version here makes drift between an old main page and a
 * fresh SW (or vice-versa) detectable instead of silent: each frame carries a
 * `version` field, and either side refuses to honour a mismatched peer.
 *
 * Bump on any wire change. The host's reaction to a mismatch is "refuse the
 * request" — the protocol does NOT attempt cross-version compatibility.
 */
export const SW_PROTOCOL_VERSION = '1';

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
  version: string;
}

export interface SwPongFrame {
  type: typeof SW_PONG;
  version: string;
  from: 'service-worker';
}

/**
 * Sent by the controlled window when its preview-bridge is subscribed and
 * ready to handle `/preview/<port>/*` fetches. Until the SW sees this frame
 * from a client, fetches for that client wait (bounded by a timeout).
 */
export interface SwPreviewReadyFrame {
  type: typeof SW_PREVIEW_READY;
  version: string;
}

/**
 * Sent on `pagehide`/`beforeunload` from the main thread, or detected by the
 * SW via `controllerchange`, to drop the client from the ready set so future
 * fetches don't hang on a defunct client.
 */
export interface SwPreviewGoodbyeFrame {
  type: typeof SW_PREVIEW_GOODBYE;
  version: string;
}

/**
 * SW→client request frame payload (the actual HTTP-ish request data, sibling
 * of the wire-envelope fields like `type`/`version`/`requestId`).
 */
export interface SerializedRequest {
  port: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | null;
}

/**
 * Discriminator for the protocol-version-mismatch error posted from the main
 * thread back to the SW when it receives a {@link SW_PREVIEW_REQUEST} frame
 * whose `version` does not match {@link SW_PROTOCOL_VERSION}. The SW maps this
 * to a 503 response (ADR-0031).
 */
export const SW_ERROR_PROTOCOL_VERSION_MISMATCH = 'PROTOCOL_VERSION_MISMATCH';

/**
 * Structured error returned by the main-thread bridge when a peer frame
 * carries a `version` that does not match {@link SW_PROTOCOL_VERSION}.
 * Receivers should map this to a 503 ("protocol version mismatch") response.
 *
 * ADR-0031 — every wire frame between the SW and the main thread carries a
 * `version` field; the receiver validates at decode time and refuses to act
 * on a mismatched peer.
 */
export interface SwProtocolVersionMismatchError {
  kind: typeof SW_ERROR_PROTOCOL_VERSION_MISMATCH;
  expected: string;
  got: string;
  message: string;
}
