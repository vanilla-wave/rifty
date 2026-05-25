/**
 * Bridge between the Service Worker and the main thread for `/preview/<port>/*`
 * fetches.
 *
 * The SW can't share JS state with the runtime Worker that owns the
 * `@rifty/net` port registry, so it forwards intercepted requests to *any*
 * controlled window client over `postMessage` + a `MessageChannel`. Whoever
 * sets up the bridge (main thread of the playground) implements the
 * `PreviewHandler` and returns a `SerializedResponse`.
 *
 * Wire format (ADR-0017 phase 1, streaming):
 *   client→sw  : { type: 'rifty:preview:ready' }
 *   sw→client  : { type: 'rifty:preview:request', port, url, method, headers,
 *                  body?: Uint8Array, requestId, replyPort: MessagePort }
 *   client→sw  : { status, statusText, headers, body: ReadableStream<Uint8Array>
 *                  | Uint8Array | null } via replyPort
 *                  — the stream is *transferred* in the postMessage transfer
 *                  list when the `ReadableStream` is transferable.
 *
 * Fallback: older Safari / Workers without transferable `ReadableStream`
 * support fall back to a `Uint8Array` buffered body. `chooseBodyTransport()`
 * decides per response which carrier to use. The contract on the SW side
 * accepts either shape — `new Response(body, init)` handles a `ReadableStream`,
 * an `ArrayBuffer`/`Uint8Array`, or `null` natively.
 */

export interface SerializedRequest {
  port: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | null;
}

export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /**
   * Streaming body. Preferred when the runtime supports transferring
   * `ReadableStream` over `postMessage`; otherwise the bridge falls back to
   * a fully-buffered `Uint8Array`. `null` / `undefined` mean "no body".
   */
  body?: ReadableStream<Uint8Array> | Uint8Array | null;
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
 * Install the SW-side fetch listener. Call inside a Service Worker after
 * `activate`. The listener intercepts `/preview/<port>/*` requests and asks
 * the first registered window client to handle them.
 *
 * Returns a teardown function — useful in tests.
 */
export function installPreviewInterceptor(scope: ServiceWorkerGlobalScope): () => void {
  const handler = (event: FetchEvent): void => {
    const url = new URL(event.request.url);
    const match = matchPreviewUrl(url.pathname);
    if (!match) return;

    event.respondWith(routePreview(scope, event.request, match));
  };

  scope.addEventListener('fetch', handler);
  return () => scope.removeEventListener('fetch', handler);
}

async function routePreview(
  scope: ServiceWorkerGlobalScope,
  request: Request,
  match: { port: number; path: string },
): Promise<Response> {
  const clients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: false });
  if (clients.length === 0) {
    return new Response(`No client to serve preview port ${match.port}`, { status: 503 });
  }
  const client = clients[0]!;
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
    channel.port1.onmessage = (e) => {
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
        type: 'rifty:preview:request',
        requestId,
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
 * Probe whether the host realm can transfer `ReadableStream` over
 * `postMessage`. Browsers that do: Chromium ≥ 89, Firefox ≥ 103. Safari
 * historically lagged (added in 16.4). When unsupported, the bridge buffers
 * the body and posts a `Uint8Array` instead.
 *
 * The probe is cached after the first call.
 */
let streamTransferSupported: boolean | null = null;
export function canTransferReadableStream(): boolean {
  if (streamTransferSupported !== null) return streamTransferSupported;
  if (typeof ReadableStream === 'undefined' || typeof MessageChannel === 'undefined') {
    streamTransferSupported = false;
    return false;
  }
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const channel = new MessageChannel();
    channel.port1.postMessage(stream, [stream as unknown as Transferable]);
    channel.port1.close();
    channel.port2.close();
    streamTransferSupported = true;
  } catch {
    streamTransferSupported = false;
  }
  return streamTransferSupported;
}

/**
 * Pack a `SerializedResponse` for `postMessage`, returning the message and
 * any transfer list. If `body` is a `ReadableStream` and the host supports
 * transferring it, this is a zero-copy hand-off. Otherwise the stream is
 * drained into a `Uint8Array` synchronously *before* this returns (so the
 * caller awaits it) and posted as a regular structured-clone.
 */
export async function packSerializedResponse(
  resp: SerializedResponse,
): Promise<{ message: SerializedResponse; transfer: Transferable[] }> {
  const body = resp.body;
  if (body instanceof ReadableStream) {
    if (canTransferReadableStream()) {
      return { message: resp, transfer: [body as unknown as Transferable] };
    }
    const buffered = await drainStream(body);
    return { message: { ...resp, body: buffered }, transfer: [] };
  }
  return { message: resp, transfer: [] };
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/**
 * Main-thread side. Listens for `rifty:preview:request` messages from the SW
 * and dispatches each to the given handler. Returns a teardown function.
 */
export function setupPreviewBridge(handler: PreviewHandler): () => void {
  if (!('serviceWorker' in navigator)) return () => {};
  const listener = async (event: MessageEvent): Promise<void> => {
    const data = event.data as { type?: string; request?: SerializedRequest };
    if (data?.type !== 'rifty:preview:request' || !data.request) return;
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
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
