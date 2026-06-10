/**
 * Bridge between the Service Worker and the realm that owns the
 * `/preview/<port>/*` handler.
 *
 * Today (ADR-0046) the owner is selected by a
 * {@link PreviewOwnerBinding} — {@link FirstWindowOwnerBinding} for the
 * historical window path or {@link WorkerOwnerBinding} for the M11
 * A-023 SW→Worker direct routing. The interceptor stays
 * binding-agnostic: it asks the binding to resolve the owner and to
 * subscribe its readiness listener, then forwards each fetch over a
 * fresh `MessageChannel`.
 *
 * Wire format (ADR-0017 phase 1 streaming, plus the ADR-0031 receive-side
 * validation, refined by ADR-0040 into a frame+routing version split):
 *
 *   client→sw  : { type: 'rifty:preview:ready',   frameVersion, routingVersion,
 *                  ports?: number[] }            // ports added in ADR-0046
 *                                                // for worker bindings;
 *                                                // additive optional per
 *                                                // ADR-0031.
 *   client→sw  : { type: 'rifty:preview:goodbye', frameVersion, routingVersion,
 *                  ports?: number[] }            // teardown
 *   sw→client  : { type: 'rifty:preview:request', frameVersion, routingVersion,
 *                  requestId,
 *                  request: { port, url, method, headers, body?: Uint8Array } }
 *                  with `replyPort: MessagePort` in the transfer list. Both
 *                  version fields are mandatory on every data frame
 *                  (ADR-0031/ADR-0040) — receivers validate at decode time
 *                  and reject mismatched peers with a structured error
 *                  carrying both `(expected, got)` pairs.
 *   client→sw  : { status, statusText, headers, frameVersion, routingVersion,
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

import { parsePreviewPath } from '@riftydev/io';
import { packSerializedResponse } from './body-transport.ts';
import { PortAwareOwnerBinding } from './owner-binding-port-aware.ts';
import type { PreviewOwnerResolver } from './owner-resolver.ts';
import type { PreviewOwnerBinding } from './preview-owner-binding.ts';
import {
  SW_ERROR_PROTOCOL_VERSION_MISMATCH,
  SW_FRAME_VERSION,
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_PREVIEW_REQUEST,
  SW_ROUTING_VERSION,
  type SerializedRequest,
  type SerializedResponse,
  type SwProtocolVersionMismatchError,
} from './protocol.ts';
import { routePreview } from './route-preview.ts';

export { canTransferReadableStream, packSerializedResponse } from './body-transport.ts';
export { FirstWindowOwnerBinding } from './owner-binding-window.ts';
export type { FirstWindowOwnerBindingOptions } from './owner-binding-window.ts';
export { PortAwareOwnerBinding } from './owner-binding-port-aware.ts';
export type { PortAwareOwnerBindingOptions } from './owner-binding-port-aware.ts';
export { WorkerOwnerBinding } from './owner-binding-worker.ts';
export type {
  WorkerOwnerBindingOptions,
  WorkerOwnerBindingLogger,
} from './owner-binding-worker.ts';
export { FirstWindowOwnerResolver } from './owner-resolver.ts';
export type { PreviewOwnerResolver } from './owner-resolver.ts';
export type {
  PreviewOwnerBinding,
  ReadinessOutcome,
  ReadinessSignal,
  ReadinessSubscription,
} from './preview-owner-binding.ts';
export type { SerializedRequest, SerializedResponse } from './protocol.ts';

export type PreviewHandler = (req: SerializedRequest) => Promise<SerializedResponse>;

const PREVIEW_READY_HEARTBEAT_MS = 1_000;

export interface PreviewBridgeOptions {
  readonly ports?: readonly number[];
}

/**
 * Match a request URL against the `/preview/<port>/...` convention. Returns
 * `null` if the URL is not a preview request, otherwise the parsed `port` and
 * rewritten upstream path (`/` if the suffix was empty).
 *
 * Thin shape-adapter over `@riftydev/io.parsePreviewPath` — the canonical regex
 * and host primitives live in `@riftydev/io/preview-protocol` (ADR-0036). This
 * wrapper preserves the historical `{port, path}` shape SW callers use.
 */
export function matchPreviewUrl(pathname: string): { port: number; path: string } | null {
  const parsed = parsePreviewPath(pathname);
  if (!parsed) return null;
  return { port: parsed.port, path: parsed.rest };
}

/**
 * Did this fetch originate *inside* the preview iframe (ADR-0074)? True for the
 * document **navigation** (`mode === 'navigate'` — `event.clientId` is empty,
 * `event.resultingClientId` is the iframe's own about-to-exist client) and for
 * every **subresource** (a non-empty `destination` like `'script'`/`'style'` —
 * `event.clientId` is the iframe client). Both must route to the controlling
 * window that owns the port, since the iframe's own client runs no
 * `setupPreviewBridge`. False for the page's own bare `fetch('/preview/…')`
 * warm-up (mode `'cors'`/`'no-cors'`, empty `destination`), which keeps the
 * ADR-0031 `resultingClientId || clientId` order.
 */
export function isPreviewFrameRequest(request: {
  mode: string;
  destination: string;
}): boolean {
  return request.mode === 'navigate' || request.destination !== '';
}

/**
 * Default timeout (ms) for the `rifty:preview:ready` handshake. If the main
 * thread does not signal readiness within this window of a preview fetch
 * arriving, the SW 503s instead of waiting forever.
 */
export const DEFAULT_READY_TIMEOUT_MS = 3_000;

/** Internal hooks for tests — production code does not need to pass anything. */
export interface MessageHandlerHooks {
  /** Override the ready-handshake timeout. Defaults to `DEFAULT_READY_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * Override the {@link PreviewOwnerBinding} that the interceptor uses
   * to resolve owners and subscribe readiness. Defaults to
   * {@link PortAwareOwnerBinding}: Worker owners that claim `ports` win,
   * historical window bridge remains the fallback.
   *
   * If both `binding` and `resolver` are supplied, `binding` wins and
   * `resolver` is ignored.
   */
  binding?: PreviewOwnerBinding;
  /**
   * Back-compat hook: override the {@link PreviewOwnerResolver} strategy
   * used by the default port-aware binding's window fallback. Ignored when
   * `binding` is supplied.
   *
   * Deprecation: ADR-0046 collapses owner resolution and readiness
   * behind {@link PreviewOwnerBinding}; swap the resolver via the
   * `binding` field instead, especially for custom non-window owners.
   */
  resolver?: PreviewOwnerResolver;
}

export interface PreviewInterceptor {
  /** Removes the fetch and message listeners. */
  teardown(): void;
}

/**
 * Install the SW-side fetch + message listeners and return a teardown handle.
 * The interceptor builds a {@link PreviewOwnerBinding} (or accepts one via
 * `hooks.binding`), calls `subscribeReadiness(scope)` to install its
 * listener, and wires each `/preview/<port>/*` fetch through `routePreview`.
 *
 * Production callers should prefer `installPreviewInterceptor`, which calls
 * this with defaults.
 */
export function createPreviewInterceptor(
  scope: ServiceWorkerGlobalScope,
  hooks: MessageHandlerHooks = {},
): PreviewInterceptor {
  const timeoutMs = hooks.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const binding =
    hooks.binding ??
    new PortAwareOwnerBinding({
      window: hooks.resolver !== undefined ? { resolver: hooks.resolver } : undefined,
    });
  const subscription = binding.subscribeReadiness(scope);

  const fetchHandler = (event: FetchEvent): void => {
    const url = new URL(event.request.url);
    const match = matchPreviewUrl(url.pathname);
    if (!match) return;
    // ADR-0074 — a request originating inside the preview iframe must resolve
    // to the controlling window (see {@link isPreviewFrameRequest}); drop its
    // own ids so the resolver falls back to the first controlled window (the
    // bridge owner). The page's bare `fetch('/preview/…')` warm-up keeps
    // ADR-0031's `resultingClientId || clientId` order (multi-window unchanged).
    const clientId = isPreviewFrameRequest(event.request)
      ? null
      : event.resultingClientId || event.clientId || null;
    event.respondWith(
      routePreview(
        scope,
        event.request,
        match,
        subscription.readiness,
        timeoutMs,
        clientId,
        binding,
      ),
    );
  };

  scope.addEventListener('fetch', fetchHandler);
  return {
    teardown(): void {
      scope.removeEventListener('fetch', fetchHandler);
      subscription.teardown();
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
export function setupPreviewBridge(
  handler: PreviewHandler,
  opts: PreviewBridgeOptions = {},
): () => void {
  if (!('serviceWorker' in navigator)) return (): void => {};
  const announceReady = (): void => {
    postHandshake(SW_PREVIEW_READY, opts.ports);
  };
  const readyHeartbeat = setInterval(announceReady, PREVIEW_READY_HEARTBEAT_MS);
  const listener = async (event: MessageEvent): Promise<void> => {
    const data = event.data as {
      type?: string;
      frameVersion?: string;
      routingVersion?: string;
      request?: SerializedRequest;
    };
    if (data?.type !== SW_PREVIEW_REQUEST || !data.request) return;
    const replyPort = event.ports[0];
    if (!replyPort) return;
    // ADR-0031 / ADR-0040 — every data frame carries both `frameVersion` and
    // `routingVersion`; receivers validate both at decode time. On mismatch
    // we reply with a structured error carrying both `(expected, got)` pairs
    // and do NOT invoke the user handler so cross-version drift cannot
    // trigger side effects.
    const gotFrame =
      typeof data.frameVersion === 'string' ? data.frameVersion : String(data.frameVersion);
    const gotRouting =
      typeof data.routingVersion === 'string' ? data.routingVersion : String(data.routingVersion);
    if (gotFrame !== SW_FRAME_VERSION || gotRouting !== SW_ROUTING_VERSION) {
      const mismatch: SwProtocolVersionMismatchError = {
        kind: SW_ERROR_PROTOCOL_VERSION_MISMATCH,
        expected: { frame: SW_FRAME_VERSION, routing: SW_ROUTING_VERSION },
        got: { frame: gotFrame, routing: gotRouting },
        message:
          `preview request protocol version mismatch: got frame=${gotFrame} routing=${gotRouting}, ` +
          `want frame=${SW_FRAME_VERSION} routing=${SW_ROUTING_VERSION}`,
      };
      // Surface the drift on the main-thread console: without this, the
      // mismatched peer just sees a blank `/preview/...` page (the SW maps the
      // structured error to HTTP/503). This is the only page-side breadcrumb
      // when `SW_FRAME_VERSION`/`SW_ROUTING_VERSION` bumps and a stale SW
      // survives the upgrade.
      console.error('[rifty/service-worker] preview request protocol mismatch', {
        expected: mismatch.expected,
        got: mismatch.got,
      });
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
  navigator.serviceWorker.addEventListener('controllerchange', announceReady);
  announceReady();
  return (): void => {
    try {
      postHandshake(SW_PREVIEW_GOODBYE, opts.ports);
    } finally {
      clearInterval(readyHeartbeat);
      navigator.serviceWorker.removeEventListener('controllerchange', announceReady);
      navigator.serviceWorker.removeEventListener('message', listener);
    }
  };
}

function postHandshake(
  type: typeof SW_PREVIEW_READY | typeof SW_PREVIEW_GOODBYE,
  ports?: readonly number[],
): void {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  const message: {
    type: typeof SW_PREVIEW_READY | typeof SW_PREVIEW_GOODBYE;
    frameVersion: string;
    routingVersion: string;
    ports?: number[];
  } = {
    type,
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
  };
  if (ports && ports.length > 0) {
    message.ports = [...ports];
  }
  controller.postMessage(message);
}
