// Generated from packages/service-worker/src/sw.ts — do not edit. Source of truth: ADR 0016.
// ../../packages/service-worker/src/preview-bridge.ts
var PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/;
function matchPreviewUrl(pathname) {
  const m = PREVIEW_PREFIX_RE.exec(pathname);
  if (!m) return null;
  const port = Number.parseInt(m[1], 10);
  const suffix = m[2] ?? "/";
  return { port, path: suffix };
}
var nextRequestId = 1;
function installPreviewInterceptor(scope) {
  const handler = (event) => {
    const url2 = new URL(event.request.url);
    const match = matchPreviewUrl(url2.pathname);
    if (!match) return;
    event.respondWith(routePreview(scope, event.request, match));
  };
  scope.addEventListener("fetch", handler);
  return () => scope.removeEventListener("fetch", handler);
}
async function routePreview(scope, request, match) {
  const clients = await scope.clients.matchAll({ type: "window", includeUncontrolled: false });
  if (clients.length === 0) {
    return new Response(`No client to serve preview port ${match.port}`, { status: 503 });
  }
  const client = clients[0];
  const channel = new MessageChannel();
  const bodyBytes = request.method === "GET" || request.method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());
  const requestId = nextRequestId++;
  const serialised = {
    port: match.port,
    url: `http://preview.local${match.path}${url(request).search}`,
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: bodyBytes
  };
  return new Promise((resolve) => {
    channel.port1.onmessage = (e) => {
      const data = e.data;
      if ("error" in data) {
        resolve(new Response(data.error, { status: 502 }));
        return;
      }
      const headers = new Headers(data.headers);
      let body = null;
      if (data.body) {
        const copy = new ArrayBuffer(data.body.byteLength);
        new Uint8Array(copy).set(data.body);
        body = copy;
      }
      resolve(new Response(body, { status: data.status, statusText: data.statusText, headers }));
    };
    client.postMessage(
      {
        type: "rifty:preview:request",
        requestId,
        request: serialised
      },
      [channel.port2]
    );
  });
}
function url(request) {
  return new URL(request.url);
}

// ../../packages/service-worker/src/sw.ts
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("message", (event) => {
  const data = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "__rifty_sw_ping__") {
    event.source?.postMessage({ type: "__rifty_sw_pong__", from: "service-worker" });
  }
});
installPreviewInterceptor(self);
