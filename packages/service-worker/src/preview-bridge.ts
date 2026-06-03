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
import { FirstWindowOwnerBinding } from './owner-binding-window.ts';
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
   * Override the {@link PreviewOwnerBinding} that the interceptor uses
   * to resolve owners and subscribe readiness. Defaults to
   * {@link FirstWindowOwnerBinding}, which preserves the M10 behaviour
   * of routing to the first controlled window client. M11 A-023 lands
   * the {@link WorkerOwnerBinding} consumer; the
   * `installPreviewInterceptor` default does not change because the
   * page is still the SW's counterpart for the legacy preview surface
   * (ADR-0043) — callers swap in `WorkerOwnerBinding` per-context.
   *
   * If both `binding` and `resolver` are supplied, `binding` wins and
   * `resolver` is ignored.
   */
  binding?: PreviewOwnerBinding;
  /**
   * Back-compat hook: override the {@link PreviewOwnerResolver} strategy
   * used by the default window binding. Equivalent to
   * `binding: new FirstWindowOwnerBinding({ resolver })`. Kept so the
   * existing parity test in
   * `tests/owner-resolver.test.ts` continues to compile without rewrite.
   * Ignored when `binding` is supplied.
   *
   * Deprecation rationale: ADR-0046 collapses owner resolution and
   * readiness behind {@link PreviewOwnerBinding}; tests and consumers
   * that want to swap the resolver should adopt the `binding` field
   * directly. The field stays in place until A-023 lands its real
   * consumer (`installPreviewInterceptor` flip).
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
    new FirstWindowOwnerBinding(
      hooks.resolver !== undefined ? { resolver: hooks.resolver } : undefined,
    );
  const subscription = binding.subscribeReadiness(scope);

  const fetchHandler = (event: FetchEvent): void => {
    const url = new URL(event.request.url);
    const match = matchPreviewUrl(url.pathname);
    if (!match) return;
    // ADR-0074 — a preview renders inside a nested <iframe>, but the bridge
    // that owns the port always lives on the controlling top-level window,
    // never on the iframe. So every request *from the preview frame* — the
    // document navigation (`mode === 'navigate'`, whose `event.clientId` is
    // empty and whose `event.resultingClientId` is the iframe's own
    // about-to-exist client that runs no `setupPreviewBridge`) and each of its
    // subresources (a non-empty `destination` like 'script'/'style', whose
    // `event.clientId` is the iframe client, which owns no bridge) — must
    // resolve to the controlling window. For those we drop the request's own
    // ids and let the resolver fall back to the first controlled window (the
    // bridge owner). Without this the readiness handshake targets a client that
    // never posts `rifty:preview:ready`, times out, and the navigation aborts
    // (`net::ERR_ABORTED`). The page's own bare `fetch('/preview/…')` warm-up
    // has an empty `destination` and is not a navigation, so it keeps ADR-0031's
    // `resultingClientId || clientId` order (multi-window routing unchanged).
    // This id selection is SW-local and off-wire — see ADR-0074's
    // "`SW_ROUTING_VERSION` stays `'1'`" section.
    const fromPreviewFrame = event.request.mode === 'navigate' || event.request.destination !== '';
    const clientId = fromPreviewFrame ? null : event.resultingClientId || event.clientId || null;
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
export function setupPreviewBridge(handler: PreviewHandler): () => void {
  if (!('serviceWorker' in navigator)) return (): void => {};
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
      // Surface the drift on the main-thread console too — without this, the
      // mismatched peer just sees a blank `/preview/...` page (the SW maps the
      // structured error back to HTTP/503) and has no signal that the SW is
      // running an older frame/routing contract. Logging here is the only
      // page-side breadcrumb when `SW_FRAME_VERSION` or `SW_ROUTING_VERSION`
      // bumps and a stale SW survives the upgrade.
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
  postHandshake(SW_PREVIEW_READY);
  return (): void => {
    postHandshake(SW_PREVIEW_GOODBYE);
    navigator.serviceWorker.removeEventListener('message', listener);
  };
}

function postHandshake(type: typeof SW_PREVIEW_READY | typeof SW_PREVIEW_GOODBYE): void {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  controller.postMessage({
    type,
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
  });
}
