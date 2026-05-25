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
 * `SW_PROTOCOL_VERSION` echo on every frame):
 *
 *   client→sw  : { type: 'rifty:preview:ready',   version }
 *   client→sw  : { type: 'rifty:preview:goodbye', version }     // teardown
 *   sw→client  : { type: 'rifty:preview:request', version,
 *                  port, url, method, headers, body?: Uint8Array,
 *                  requestId, replyPort: MessagePort }
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

import { type SerializedResponse, packSerializedResponse } from './body-transport.ts';
import {
  SW_PREVIEW_GOODBYE,
  SW_PREVIEW_READY,
  SW_PREVIEW_REQUEST,
  SW_PROTOCOL_VERSION,
} from './protocol.ts';
import { type ReadyClientsRegistry, createReadyClientsRegistry } from './ready-clients.ts';

export type { SerializedResponse } from './body-transport.ts';
export { canTransferReadableStream, packSerializedResponse } from './body-transport.ts';

export interface SerializedRequest {
  port: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | null;
}

export type PreviewHandler = (req: SerializedRequest) => Promise<SerializedResponse>;

const PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/;

/**
 * Match a request URL against the `/preview/<port>/...` convention. Returns
 * `null` if the URL is not a preview request, otherwise the parsed `port` and
 * rewritten upstream path (`/` if the suffix was empty).
 */
export function matchPreviewUrl(pathname: string): { port: number; path: string } | null {
  const m = PREVIEW_PREFIX_RE.exec(pathname);
  if (!m) return null;
  const port = Number.parseInt(m[1]!, 10);
  const suffix = m[2] ?? '/';
  return { port, path: suffix };
}

let nextRequestId = 1;

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
    event.respondWith(routePreview(scope, event.request, match, registry, timeoutMs));
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

async function routePreview(
  scope: ServiceWorkerGlobalScope,
  request: Request,
  match: { port: number; path: string },
  registry: ReadyClientsRegistry,
  timeoutMs: number,
): Promise<Response> {
  const clients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: false });
  if (clients.length === 0) {
    return new Response(`No client to serve preview port ${match.port}`, { status: 503 });
  }
  const client = clients[0]!;
  if (registry.isMismatched(client.id)) {
    return new Response('protocol version mismatch', { status: 503 });
  }
  const outcome = await registry.waitForReady(client.id, timeoutMs);
  if (outcome === 'mismatch') {
    return new Response('protocol version mismatch', { status: 503 });
  }
  if (outcome === 'timeout') {
    if (registry.isMismatched(client.id)) {
      return new Response('protocol version mismatch', { status: 503 });
    }
    return new Response(`preview-bridge not ready within ${timeoutMs}ms`, { status: 503 });
  }

  const channel = new MessageChannel();
  const bodyBytes =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : new Uint8Array(await request.arrayBuffer());
  const requestId = nextRequestId++;
  const serialised: SerializedRequest = {
    port: match.port,
    url: `http://preview.local${match.path}${url(request).search}`,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: bodyBytes,
  };

  return new Promise<Response>((resolve) => {
    channel.port1.onmessage = (e): void => {
      const data = e.data as SerializedResponse | { error: string };
      if ('error' in data) {
        resolve(new Response(data.error, { status: 502 }));
        return;
      }
      const headers = new Headers(data.headers);
      // The playground page is cross-origin-isolated (COOP same-origin + COEP
      // credentialless — D-001). Iframe-loaded preview responses need their
      // own CORP + COEP or the browser blocks them. Set defaults that match
      // the page; explicit handler-supplied values win because Headers.set
      // here would overwrite — only set if absent.
      if (!headers.has('Cross-Origin-Resource-Policy')) {
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      if (!headers.has('Cross-Origin-Embedder-Policy')) {
        headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
      }
      let body: BodyInit | null = null;
      const raw = data.body;
      if (raw instanceof ReadableStream) {
        body = raw;
      } else if (raw instanceof Uint8Array) {
        const copy = new ArrayBuffer(raw.byteLength);
        new Uint8Array(copy).set(raw);
        body = copy;
      } else if (raw != null) {
        // Defensive: handle plain ArrayBuffer too. `data` is structured-cloned
        // on the wire, so a Uint8Array view becomes a Uint8Array again, and
        // an ArrayBuffer stays an ArrayBuffer.
        body = raw as ArrayBuffer;
      }
      resolve(new Response(body, { status: data.status, statusText: data.statusText, headers }));
    };
    client.postMessage(
      {
        type: SW_PREVIEW_REQUEST,
        requestId,
        version: SW_PROTOCOL_VERSION,
        request: serialised,
      },
      [channel.port2],
    );
  });
}

function url(request: Request): URL {
  return new URL(request.url);
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
