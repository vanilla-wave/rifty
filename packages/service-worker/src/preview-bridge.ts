/**
 * Bridge between the Service Worker and the main thread for `/preview/<port>/*`
 * fetches.
 *
 * The SW can't share JS state with the runtime Worker that owns the
 * `@rifty/net` port registry, so it forwards intercepted requests to a
 * controlled window client over `postMessage` + a `MessageChannel`. Whoever
 * sets up the bridge (main thread of the playground) implements the
 * `PreviewHandler` and returns a `SerializedResponse`.
 *
 * Wire format (ADR-0017 phase 1 streaming, plus the ADR-0016
 * `SW_PROTOCOL_VERSION` echo on every frame, ADR-0031 receive-side validation):
 *
 *   client→sw  : { type: 'rifty:preview:ready',   version }
 *   client→sw  : { type: 'rifty:preview:goodbye', version }     // teardown
 *   sw→client  : { type: 'rifty:preview:request', version, requestId,
 *                  request: { port, url, method, headers, body?: Uint8Array } }
 *                  with `replyPort: MessagePort` in the transfer list. The
 *                  `version` field is mandatory on every data frame
 *                  (ADR-0031) — receivers validate it at decode time and
 *                  reject mismatched peers with a structured error.
 *   client→sw  : { status, statusText, headers, version,
 *                  body: ReadableStream<Uint8Array> | Uint8Array | null }
 *                  via replyPort — the stream is *transferred* in the
 *                  postMessage transfer list when the runtime supports
 *                  transferable `ReadableStream`.
 *
 * Handshake semantics: until the SW sees a `rifty:preview:ready` from a given
 * client, fetches for that client wait, bounded by a 3-second timeout that
 * 503s with a clear message. This eliminates the race where the very first
 * iframe fetch races the bridge subscription and previously returned
 * `503 No client`.
 *
 * Fallback for older Safari / Workers without transferable `ReadableStream`
 * support: `chooseBodyTransport()` decides per response which carrier to use.
 * The contract on the SW side accepts either shape — `new Response(body, init)`
 * handles a `ReadableStream`, an `ArrayBuffer`/`Uint8Array`, or `null`
 * natively.
 */

import { parsePreviewPath } from '@rifty/io';
import { packSerializedResponse } from './body-transport.ts';
import { FirstWindowOwnerResolver, type PreviewOwnerResolver } from './owner-resolver.ts';
import {
  SW_ERROR_PROTOCOL_VERSION_MISMATCH,
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_PREVIEW_REQUEST,
  SW_PROTOCOL_VERSION,
  type SerializedRequest,
  type SerializedResponse,
  type SwProtocolVersionMismatchError,
} from './protocol.ts';
import { createReadyClientsRegistry } from './ready-clients.ts';
import { routePreview } from './route-preview.ts';

export { canTransferReadableStream, packSerializedResponse } from './body-transport.ts';
export { FirstWindowOwnerResolver } from './owner-resolver.ts';
export type { PreviewOwnerResolver } from './owner-resolver.ts';
export type { SerializedRequest, SerializedResponse } from './protocol.ts';

export type PreviewHandler = (req: SerializedRequest) => Promise<SerializedResponse>;

/**
 * Match a request URL against the `/preview/<port>/...` convention. Returns
 * `null` if the URL is not a preview request, otherwise the parsed `port` and
 * rewritten upstream path (`/` if the suffix was empty).
 *
 * Thin shape-adapter over `@rifty/io.parsePreviewPath` — the canonical regex
 * and host primitives live in `@rifty/io/preview-protocol` (ADR-0036). This
 * wrapper preserves the historical `{port, path}` shape SW callers use.
 */
export function matchPreviewUrl(pathname: string): { port: number; path: string } | null {
  const parsed = parsePreviewPath(pathname);
  if (!parsed) return null;
  return { port: parsed.port, path: parsed.rest };
}

/**
 * Default timeout (ms) for the `rifty:preview:ready` handshake. If the main
 * thread does not signal readiness within this window of a preview fetch
 * arriving, the SW responds with a 503 instead of waiting forever.
 */
export const DEFAULT_READY_TIMEOUT_MS = 3_000;

/** Internal hooks for tests — production code does not need to pass anything. */
export interface MessageHandlerHooks {
  /** Override the ready-handshake timeout. Defaults to `DEFAULT_READY_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * Override the {@link PreviewOwnerResolver} strategy. Defaults to
   * {@link FirstWindowOwnerResolver}, which preserves the M10 behaviour of
   * routing to the first controlled window client. M11 A-026 swaps this
   * default for a `WorkerOwnerResolver` that consults the cross-realm
   * `@rifty/net` port registry; see ADR-0011, ADR-0017, and `REVIEW_ACTIONS.md`
   * A-023/A-026. Tests pass a mock resolver to exercise the seam without
   * spinning up the runtime port registry.
   */
  resolver?: PreviewOwnerResolver;
}

export interface PreviewInterceptor {
  /** Removes the fetch and message listeners. */
  teardown(): void;
}

/**
 * Install the SW-side fetch + message listeners and return a teardown handle.
 * Internal state (ready set, waiters, mismatch-warn dedup) lives inside the
 * registry returned by `createReadyClientsRegistry` so multiple interceptors
 * don't share state in tests.
 *
 * Production callers should prefer `installPreviewInterceptor`, which calls
 * this with defaults.
 */
export function createPreviewInterceptor(
  scope: ServiceWorkerGlobalScope,
  hooks: MessageHandlerHooks = {},
): PreviewInterceptor {
  const timeoutMs = hooks.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const resolver = hooks.resolver ?? new FirstWindowOwnerResolver();
  const registry = createReadyClientsRegistry();

  const messageHandler = (event: ExtendableMessageEvent): void => {
    const data = event.data as { type?: string; version?: string } | null | undefined;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type !== SW_PREVIEW_READY && data.type !== SW_PREVIEW_GOODBYE) return;
    const source = event.source as Client | null;
    const clientId = source && 'id' in source ? source.id : null;
    if (!clientId) return;
    registry.handleMessage(clientId, data);
  };

  const fetchHandler = (event: FetchEvent): void => {
    const url = new URL(event.request.url);
    const match = matchPreviewUrl(url.pathname);
    if (!match) return;
    // ADR-0031 — prefer `event.resultingClientId` (for navigations that create
    // a new client) then `event.clientId`, so multi-window pages route to the
    // correct owner instead of always picking the first match.
    const clientId = event.resultingClientId || event.clientId || null;
    event.respondWith(
      routePreview(scope, event.request, match, registry, timeoutMs, clientId, resolver),
    );
  };

  scope.addEventListener('fetch', fetchHandler);
  scope.addEventListener('message', messageHandler);
  return {
    teardown(): void {
      scope.removeEventListener('fetch', fetchHandler);
      scope.removeEventListener('message', messageHandler);
    },
  };
}

/**
 * Install the SW-side fetch listener. Call inside a Service Worker after
 * `activate`. The listener intercepts `/preview/<port>/*` requests and asks
 * the first registered, ready window client to handle them.
 *
 * Returns a teardown function — useful in tests.
 */
export function installPreviewInterceptor(scope: ServiceWorkerGlobalScope): () => void {
  const handle = createPreviewInterceptor(scope);
  return () => handle.teardown();
}

/**
 * Main-thread side. Listens for `rifty:preview:request` messages from the SW
 * and dispatches each to the given handler. Posts the
 * `rifty:preview:ready` handshake to the active SW on init so the SW knows
 * this client is subscribed; posts `rifty:preview:goodbye` on teardown.
 * Returns a teardown function.
 */
export function setupPreviewBridge(handler: PreviewHandler): () => void {
  if (!('serviceWorker' in navigator)) return (): void => {};
  const listener = async (event: MessageEvent): Promise<void> => {
    const data = event.data as {
      type?: string;
      version?: string;
      request?: SerializedRequest;
    };
    if (data?.type !== SW_PREVIEW_REQUEST || !data.request) return;
    const replyPort = event.ports[0];
    if (!replyPort) return;
    // ADR-0031 — every data frame carries `version`; receivers validate at
    // decode time. On mismatch we reply with a structured error and do NOT
    // invoke the user handler so cross-version drift cannot trigger
    // side effects.
    if (data.version !== SW_PROTOCOL_VERSION) {
      const got = typeof data.version === 'string' ? data.version : String(data.version);
      const mismatch: SwProtocolVersionMismatchError = {
        kind: SW_ERROR_PROTOCOL_VERSION_MISMATCH,
        expected: SW_PROTOCOL_VERSION,
        got,
        message: `preview request protocol version mismatch: got ${got}, want ${SW_PROTOCOL_VERSION}`,
      };
      replyPort.postMessage({ error: mismatch });
      return;
    }
    try {
      const resp = await handler(data.request);
      const { message, transfer } = await packSerializedResponse(resp);
      replyPort.postMessage(message, transfer);
    } catch (err) {
      replyPort.postMessage({ error: (err as Error).message });
    }
  };
  navigator.serviceWorker.addEventListener('message', listener);
  postHandshake(SW_PREVIEW_READY);
  return (): void => {
    postHandshake(SW_PREVIEW_GOODBYE);
    navigator.serviceWorker.removeEventListener('message', listener);
  };
}

function postHandshake(type: typeof SW_PREVIEW_READY | typeof SW_PREVIEW_GOODBYE): void {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  controller.postMessage({ type, version: SW_PROTOCOL_VERSION });
}
