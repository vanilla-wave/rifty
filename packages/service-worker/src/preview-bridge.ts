/**
 * Bridge between the Service Worker and the main thread for `/preview/<port>/*`
 * fetches.
 *
 * The SW can't share JS state with the runtime Worker that owns the
 * `@rifty/net` port registry, so it forwards intercepted requests to *any*
 * controlled window client over `postMessage` + a `MessageChannel`. Whoever
 * sets up the bridge (main thread of the playground) implements the
 * `PreviewHandler` and returns a `Response`.
 *
 * Wire format:
 *   client→sw  : { type: 'rifty:preview:ready' }
 *   sw→client  : { type: 'rifty:preview:request', port, url, method, headers,
 *                  body?: Uint8Array, requestId, replyPort: MessagePort }
 *   client→sw  : { status, statusText, headers, body: Uint8Array | undefined }
 *                via replyPort
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
      if (data.body) {
        const copy = new ArrayBuffer(data.body.byteLength);
        new Uint8Array(copy).set(data.body);
        body = copy;
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
      replyPort.postMessage(resp);
    } catch (err) {
      replyPort.postMessage({ error: (err as Error).message });
    }
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
