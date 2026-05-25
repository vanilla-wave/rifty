// Generated from packages/service-worker/src/sw.ts — do not edit. Source of truth: ADR 0016.
// ../../packages/service-worker/src/protocol.ts
var SW_PROTOCOL_VERSION = "1";
var SW_PING = "__rifty_sw_ping__";
var SW_PONG = "__rifty_sw_pong__";
var SW_PREVIEW_READY = "rifty:preview:ready";
var SW_PREVIEW_GOODBYE = "rifty:preview:goodbye";
var SW_PREVIEW_REQUEST = "rifty:preview:request";

// ../../packages/service-worker/src/ready-clients.ts
var defaultLogger = {
  warn(msg) {
    console.warn(msg);
  }
};
function createReadyClientsRegistry(logger = defaultLogger) {
  const ready = /* @__PURE__ */ new Set();
  const waiters = /* @__PURE__ */ new Map();
  const mismatched = /* @__PURE__ */ new Set();
  const warned = /* @__PURE__ */ new Set();
  function markReady(id) {
    ready.add(id);
    const waiterSet = waiters.get(id);
    if (waiterSet) {
      for (const w of waiterSet) w.resolve();
      waiters.delete(id);
    }
  }
  function markGoodbye(id) {
    ready.delete(id);
    const waiterSet = waiters.get(id);
    if (waiterSet) {
      for (const w of waiterSet) {
        w.reject(new Error("client departed during handshake"));
      }
      waiters.delete(id);
    }
  }
  function failWaitersWithMismatch(id) {
    const waiterSet = waiters.get(id);
    if (waiterSet) {
      for (const w of waiterSet) w.reject(new Error("protocol version mismatch"));
      waiters.delete(id);
    }
  }
  return {
    isReady(id) {
      return ready.has(id);
    },
    isMismatched(id) {
      return mismatched.has(id);
    },
    waitForReady(id, timeoutMs) {
      if (mismatched.has(id)) return Promise.resolve("mismatch");
      if (ready.has(id)) return Promise.resolve("ready");
      return new Promise((resolve) => {
        let timer = null;
        const waiter = {
          resolve: () => {
            if (timer !== null) clearTimeout(timer);
            resolve("ready");
          },
          reject: (err) => {
            if (timer !== null) clearTimeout(timer);
            resolve(err.message === "protocol version mismatch" ? "mismatch" : "timeout");
          }
        };
        const set = waiters.get(id) ?? /* @__PURE__ */ new Set();
        set.add(waiter);
        waiters.set(id, set);
        timer = setTimeout(() => {
          const s = waiters.get(id);
          if (s) {
            s.delete(waiter);
            if (s.size === 0) waiters.delete(id);
          }
          resolve("timeout");
        }, timeoutMs);
      });
    },
    handleMessage(clientId, data) {
      const type = data?.type;
      if (type !== SW_PREVIEW_READY && type !== SW_PREVIEW_GOODBYE) return;
      if (data.version !== SW_PROTOCOL_VERSION) {
        if (!warned.has(clientId)) {
          warned.add(clientId);
          logger.warn(
            `[rifty/service-worker] protocol version mismatch from client ${clientId}: got ${String(
              data.version
            )}, want ${SW_PROTOCOL_VERSION}`
          );
        }
        mismatched.add(clientId);
        failWaitersWithMismatch(clientId);
        return;
      }
      if (type === SW_PREVIEW_READY) {
        markReady(clientId);
      } else {
        markGoodbye(clientId);
      }
    }
  };
}

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
var DEFAULT_READY_TIMEOUT_MS = 3e3;
function createPreviewInterceptor(scope, hooks = {}) {
  const timeoutMs = hooks.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const registry = createReadyClientsRegistry();
  const messageHandler = (event) => {
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (data.type !== SW_PREVIEW_READY && data.type !== SW_PREVIEW_GOODBYE) return;
    const source = event.source;
    const clientId = source && "id" in source ? source.id : null;
    if (!clientId) return;
    registry.handleMessage(clientId, data);
  };
  const fetchHandler = (event) => {
    const url2 = new URL(event.request.url);
    const match = matchPreviewUrl(url2.pathname);
    if (!match) return;
    event.respondWith(routePreview(scope, event.request, match, registry, timeoutMs));
  };
  scope.addEventListener("fetch", fetchHandler);
  scope.addEventListener("message", messageHandler);
  return {
    teardown() {
      scope.removeEventListener("fetch", fetchHandler);
      scope.removeEventListener("message", messageHandler);
    }
  };
}
function installPreviewInterceptor(scope) {
  const handle = createPreviewInterceptor(scope);
  return () => handle.teardown();
}
async function routePreview(scope, request, match, registry, timeoutMs) {
  const clients = await scope.clients.matchAll({ type: "window", includeUncontrolled: false });
  if (clients.length === 0) {
    return new Response(`No client to serve preview port ${match.port}`, { status: 503 });
  }
  const client = clients[0];
  if (registry.isMismatched(client.id)) {
    return new Response("protocol version mismatch", { status: 503 });
  }
  const outcome = await registry.waitForReady(client.id, timeoutMs);
  if (outcome === "mismatch") {
    return new Response("protocol version mismatch", { status: 503 });
  }
  if (outcome === "timeout") {
    if (registry.isMismatched(client.id)) {
      return new Response("protocol version mismatch", { status: 503 });
    }
    return new Response(`preview-bridge not ready within ${timeoutMs}ms`, { status: 503 });
  }
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
      if (!headers.has("Cross-Origin-Resource-Policy")) {
        headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      }
      if (!headers.has("Cross-Origin-Embedder-Policy")) {
        headers.set("Cross-Origin-Embedder-Policy", "credentialless");
      }
      let body = null;
      const raw = data.body;
      if (raw instanceof ReadableStream) {
        body = raw;
      } else if (raw instanceof Uint8Array) {
        const copy = new ArrayBuffer(raw.byteLength);
        new Uint8Array(copy).set(raw);
        body = copy;
      } else if (raw != null) {
        body = raw;
      }
      resolve(new Response(body, { status: data.status, statusText: data.statusText, headers }));
    };
    client.postMessage(
      {
        type: SW_PREVIEW_REQUEST,
        requestId,
        version: SW_PROTOCOL_VERSION,
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
var pingMismatchWarned = /* @__PURE__ */ new Set();
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object" || data.type !== SW_PING) return;
  const source = event.source;
  const clientId = source && "id" in source && typeof source.id === "string" ? source.id : "<unknown>";
  if (data.version !== SW_PROTOCOL_VERSION) {
    if (!pingMismatchWarned.has(clientId)) {
      pingMismatchWarned.add(clientId);
      console.warn(
        `[rifty/service-worker] ping protocol version mismatch from ${clientId}: got ${String(
          data.version
        )}, want ${SW_PROTOCOL_VERSION}`
      );
    }
    return;
  }
  event.source?.postMessage({
    type: SW_PONG,
    version: SW_PROTOCOL_VERSION,
    from: "service-worker"
  });
});
installPreviewInterceptor(self);
