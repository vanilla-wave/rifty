// Generated from packages/service-worker/src/sw.ts — do not edit. Source of truth: ADR 0016.
// ../../packages/io/src/preview-protocol.ts
var PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/;
var PREVIEW_LOCAL_HOST = "preview.local";
function synthesizePreviewUrl(path) {
  return `http://${PREVIEW_LOCAL_HOST}${path}`;
}
function parsePreviewPath(path) {
  const m = PREVIEW_PREFIX_RE.exec(path);
  if (!m) return null;
  const port = Number.parseInt(m[1], 10);
  const rest = m[2] ?? "/";
  return { port, rest };
}

// ../../packages/service-worker/src/protocol.ts
var SW_FRAME_VERSION = "1";
var SW_ROUTING_VERSION = "4";
var SW_PING = "__rifty_sw_ping__";
var SW_PONG = "__rifty_sw_pong__";
var SW_PREVIEW_READY = "rifty:preview:ready";
var SW_PREVIEW_GOODBYE = "rifty:preview:goodbye";
var SW_PREVIEW_REQUEST = "rifty:preview:request";
var SW_ERROR_PROTOCOL_VERSION_MISMATCH = "PROTOCOL_VERSION_MISMATCH";

// ../../packages/service-worker/src/owner-resolver.ts
var fallbackWarned = /* @__PURE__ */ new WeakSet();
var FirstWindowOwnerResolver = class {
  async resolveOwner(scope, _request, clientId) {
    if (clientId) {
      const direct = await scope.clients.get(clientId);
      if (direct) return direct;
    }
    const all = await scope.clients.matchAll({
      type: "window",
      includeUncontrolled: false
    });
    if (all.length === 0) return null;
    if (!fallbackWarned.has(scope)) {
      fallbackWarned.add(scope);
      console.warn(
        "[rifty/service-worker] preview fetch had no clientId; falling back to first controlled window"
      );
    }
    return all[0] ?? null;
  }
};

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
  const ownerTokens = /* @__PURE__ */ new Map();
  const portsByClient = /* @__PURE__ */ new Map();
  let nextRequestIdCounter = 1;
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
    ownerTokens.delete(id);
    portsByClient.delete(id);
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
    ownerToken(id) {
      return ownerTokens.get(id);
    },
    readyOwnersOfPort(port) {
      const owners = [];
      for (const [id, ports] of portsByClient) {
        if (ready.has(id) && ports.has(port)) owners.push(id);
      }
      return owners;
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
      const frameOk = data.frameVersion === SW_FRAME_VERSION;
      const routingOk = data.routingVersion === SW_ROUTING_VERSION;
      if (!frameOk || !routingOk) {
        if (!warned.has(clientId)) {
          warned.add(clientId);
          const drifted = [];
          if (!frameOk) drifted.push("frame");
          if (!routingOk) drifted.push("routing");
          logger.warn(
            `[rifty/service-worker] protocol version mismatch from client ${clientId} (${drifted.join(
              "+"
            )}): got frame=${String(data.frameVersion)} routing=${String(
              data.routingVersion
            )}, want frame=${SW_FRAME_VERSION} routing=${SW_ROUTING_VERSION}`
          );
        }
        mismatched.add(clientId);
        failWaitersWithMismatch(clientId);
        return;
      }
      const ports = Array.isArray(data.ports) ? data.ports.filter((p) => Number.isInteger(p)) : [];
      if (type === SW_PREVIEW_READY) {
        if (typeof data.ownerToken === "string" && data.ownerToken.length > 0) {
          ownerTokens.set(clientId, data.ownerToken);
        }
        if (ports.length > 0) {
          const set = portsByClient.get(clientId) ?? /* @__PURE__ */ new Set();
          for (const p of ports) set.add(p);
          portsByClient.set(clientId, set);
        }
        markReady(clientId);
      } else if (ports.length > 0) {
        const set = portsByClient.get(clientId);
        if (set) {
          for (const p of ports) set.delete(p);
        }
        if (!set || set.size === 0) markGoodbye(clientId);
      } else {
        markGoodbye(clientId);
      }
    },
    nextRequestId() {
      return nextRequestIdCounter++;
    }
  };
}

// ../../packages/service-worker/src/owner-binding-window.ts
var FirstWindowOwnerBinding = class {
  #resolver;
  #logger;
  #isUntrustedSource;
  #readiness = /* @__PURE__ */ new WeakMap();
  #registries = /* @__PURE__ */ new WeakMap();
  constructor(opts = {}) {
    this.#resolver = opts.resolver ?? new FirstWindowOwnerResolver();
    this.#logger = opts.logger;
    this.#isUntrustedSource = opts.isUntrustedSource;
  }
  async resolveOwner(scope, request, clientId, port) {
    const owner = await this.#resolver.resolveOwner(scope, request, clientId);
    if (clientId || !owner) return owner;
    const portRes = await this.#resolvePortWindows(scope, port);
    if (portRes.kind === "unique") return portRes.client;
    if (portRes.kind === "multiple") return null;
    const readiness = this.#readiness.get(scope);
    if (!readiness || readiness.isReady(owner.id) || readiness.isMismatched(owner.id)) {
      return owner;
    }
    const windows = await scope.clients.matchAll({
      type: "window",
      includeUncontrolled: false
    });
    return windows.find(
      (candidate) => (!("type" in candidate) || candidate.type === "window") && readiness.isReady(candidate.id)
    ) ?? owner;
  }
  // ADR-0160: which ready windows advertised `port`. 'unique' carries the only
  // live one; 'multiple' = ambiguous (503); 'none' = no port-keyed owner ->
  // legacy fallback.
  async #resolvePortWindows(scope, port) {
    const registry = this.#registries.get(scope);
    if (!registry) return { kind: "none" };
    const ids = registry.readyOwnersOfPort(port);
    if (ids.length === 0) return { kind: "none" };
    const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: false });
    const byId = new Map(windows.map((w) => [w.id, w]));
    const live = ids.map((id) => byId.get(id)).filter((c) => !!c && (!("type" in c) || c.type === "window"));
    if (live.length === 0) return { kind: "none" };
    if (live.length === 1) return { kind: "unique", client: live[0] };
    return { kind: "multiple" };
  }
  subscribeReadiness(scope) {
    const registry = this.#logger !== void 0 ? createReadyClientsRegistry(this.#logger) : createReadyClientsRegistry();
    this.#registries.set(scope, registry);
    const authWarned = /* @__PURE__ */ new Set();
    const logger = this.#logger;
    const messageHandler = (event) => {
      const ev = event;
      const data = ev.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (data.type !== SW_PREVIEW_READY && data.type !== SW_PREVIEW_GOODBYE) return;
      const source = ev.source;
      const sourceId = source && "id" in source ? source.id : null;
      if (!sourceId) return;
      if (this.#isUntrustedSource?.(sourceId)) {
        if (!authWarned.has(sourceId)) {
          authWarned.add(sourceId);
          logger?.warn(
            `[rifty/service-worker] rejected preview handshake from preview-document client ${sourceId} (anti-hijack)`
          );
        }
        return;
      }
      registry.handleMessage(sourceId, data);
    };
    scope.addEventListener("message", messageHandler);
    const readiness = {
      isReady: (id) => registry.isReady(id),
      isMismatched: (id) => registry.isMismatched(id),
      ownerToken: (id) => registry.ownerToken(id),
      // Returns the registry promise directly — simplest form. The old
      // fixed-microtask-turn invariant is dropped (ADR-0125): handshake tests
      // flush a turn budget, not an exact count, so wrapper unwrap ticks are
      // not observable.
      //
      // The window registry has no separate "gone" signal: a window teardown
      // arrives as a goodbye, which {@link createReadyClientsRegistry}
      // surfaces as `'timeout'` for backward compat. The contract reserves
      // `'gone'` for explicit owner-departed signals, which the window binding
      // can never distinguish from a plain timeout. Worker bindings do emit it.
      waitForReady: (id, timeoutMs) => registry.waitForReady(id, timeoutMs),
      nextRequestId: () => registry.nextRequestId()
    };
    this.#readiness.set(scope, readiness);
    const readinessByScope = this.#readiness;
    const registriesByScope = this.#registries;
    return {
      readiness,
      teardown() {
        scope.removeEventListener("message", messageHandler);
        readinessByScope.delete(scope);
        registriesByScope.delete(scope);
      }
    };
  }
};

// ../../packages/service-worker/src/owner-binding-worker.ts
var defaultLogger2 = {
  warn(msg) {
    console.warn(msg);
  }
};
function createState() {
  return {
    ready: /* @__PURE__ */ new Set(),
    mismatched: /* @__PURE__ */ new Set(),
    warned: /* @__PURE__ */ new Set(),
    portOwners: /* @__PURE__ */ new Map(),
    ownerPorts: /* @__PURE__ */ new Map(),
    waiters: /* @__PURE__ */ new Map(),
    requestIdCounter: 1
  };
}
function resolveWaiters(state, ownerId, outcome) {
  const set = state.waiters.get(ownerId);
  if (!set) return;
  for (const w of set) w.resolve(outcome);
  state.waiters.delete(ownerId);
}
function routeKey(ownerToken, port) {
  return `${ownerToken}\0${port}`;
}
function routeKeyPort(key) {
  const i = key.lastIndexOf("\0");
  if (i === -1) return null;
  const port = Number.parseInt(key.slice(i + 1), 10);
  return Number.isInteger(port) ? port : null;
}
function dropOwner(state, ownerId) {
  state.ready.delete(ownerId);
  const keys = state.ownerPorts.get(ownerId);
  if (keys) {
    for (const key of keys) {
      if (state.portOwners.get(key) === ownerId) {
        state.portOwners.delete(key);
      }
    }
    state.ownerPorts.delete(ownerId);
  }
}
function dropPorts(state, ownerId, ownerToken, ports) {
  const keys = state.ownerPorts.get(ownerId);
  if (!keys) return;
  for (const port of ports) {
    const key = routeKey(ownerToken, port);
    if (state.portOwners.get(key) === ownerId) {
      state.portOwners.delete(key);
    }
    keys.delete(key);
  }
  if (keys.size === 0) {
    state.ownerPorts.delete(ownerId);
    state.ready.delete(ownerId);
  }
}
var WorkerOwnerBinding = class {
  #logger;
  #states = /* @__PURE__ */ new WeakMap();
  constructor(opts = {}) {
    this.#logger = opts.logger ?? defaultLogger2;
  }
  async resolveOwner(scope, _request, ownerToken, port) {
    const state = this.#states.get(scope);
    if (!state) return null;
    if (!ownerToken) return null;
    const ownerId = state.portOwners.get(routeKey(ownerToken, port));
    if (!ownerId) return null;
    const client = await scope.clients.get(ownerId) ?? null;
    if (!client) {
      dropOwner(state, ownerId);
      resolveWaiters(state, ownerId, "gone");
      return null;
    }
    return client;
  }
  /**
   * Which live Workers claim `port` across ALL owner tokens — the
   * copied-top-level fast path (ADR-0125). `'unique'` carries the only live
   * claimant; `'multiple'` = ambiguous, caller refuses (503); `'none'` = fall
   * back to window resolution. Side effect: dead claimants are dropped and
   * their in-flight `waitForReady` waiters resolve `'gone'`.
   */
  async resolvePortOwners(scope, port) {
    const state = this.#states.get(scope);
    if (!state) return { kind: "none" };
    const candidateIds = /* @__PURE__ */ new Set();
    for (const [key, ownerId] of state.portOwners) {
      if (routeKeyPort(key) === port) candidateIds.add(ownerId);
    }
    const live = [];
    for (const ownerId of candidateIds) {
      const client = await scope.clients.get(ownerId) ?? null;
      if (client) {
        live.push(client);
      } else {
        dropOwner(state, ownerId);
        resolveWaiters(state, ownerId, "gone");
      }
    }
    if (live.length === 0) return { kind: "none" };
    if (live.length === 1) return { kind: "unique", client: live[0] };
    return { kind: "multiple" };
  }
  subscribeReadiness(scope) {
    const state = createState();
    this.#states.set(scope, state);
    const handleMessage = (event) => {
      const ev = event;
      const data = ev.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (data.type !== SW_PREVIEW_READY && data.type !== SW_PREVIEW_GOODBYE) return;
      const source = ev.source;
      const sourceId = source && "id" in source ? source.id : null;
      if (!sourceId) return;
      if (source && "type" in source && source.type !== "worker") return;
      const frameOk = data.frameVersion === SW_FRAME_VERSION;
      const routingOk = data.routingVersion === SW_ROUTING_VERSION;
      if (!frameOk || !routingOk) {
        if (!state.warned.has(sourceId)) {
          state.warned.add(sourceId);
          const drifted = [];
          if (!frameOk) drifted.push("frame");
          if (!routingOk) drifted.push("routing");
          this.#logger.warn(
            `[rifty/service-worker] worker preview protocol mismatch from ${sourceId} (${drifted.join(
              "+"
            )}): got frame=${String(data.frameVersion)} routing=${String(
              data.routingVersion
            )}, want frame=${SW_FRAME_VERSION} routing=${SW_ROUTING_VERSION}`
          );
        }
        state.mismatched.add(sourceId);
        resolveWaiters(state, sourceId, "mismatch");
        return;
      }
      const ports = Array.isArray(data.ports) ? data.ports.filter((p) => Number.isInteger(p)) : [];
      const ownerToken = typeof data.ownerToken === "string" && data.ownerToken.length > 0 ? data.ownerToken : null;
      if (data.type === SW_PREVIEW_READY) {
        state.ready.add(sourceId);
        if (ownerToken && ports.length > 0) {
          const owned = state.ownerPorts.get(sourceId) ?? /* @__PURE__ */ new Set();
          for (const port of ports) {
            const key = routeKey(ownerToken, port);
            state.portOwners.set(key, sourceId);
            owned.add(key);
          }
          state.ownerPorts.set(sourceId, owned);
        }
        resolveWaiters(state, sourceId, "ready");
      } else {
        if (ownerToken && ports.length > 0) {
          dropPorts(state, sourceId, ownerToken, ports);
        } else {
          dropOwner(state, sourceId);
        }
        if (!state.ready.has(sourceId)) {
          resolveWaiters(state, sourceId, "gone");
        }
      }
    };
    scope.addEventListener("message", handleMessage);
    const readiness = {
      isReady: (id) => state.ready.has(id),
      isMismatched: (id) => state.mismatched.has(id),
      waitForReady(id, timeoutMs) {
        if (state.mismatched.has(id)) return Promise.resolve("mismatch");
        if (state.ready.has(id)) return Promise.resolve("ready");
        return new Promise((resolve) => {
          let timer = null;
          const waiter = {
            resolve(outcome) {
              if (timer !== null) clearTimeout(timer);
              resolve(outcome);
            }
          };
          const set = state.waiters.get(id) ?? /* @__PURE__ */ new Set();
          set.add(waiter);
          state.waiters.set(id, set);
          timer = setTimeout(() => {
            const s = state.waiters.get(id);
            if (s) {
              s.delete(waiter);
              if (s.size === 0) state.waiters.delete(id);
            }
            resolve("timeout");
          }, timeoutMs);
        });
      },
      nextRequestId: () => state.requestIdCounter++
    };
    return {
      readiness,
      teardown: () => {
        scope.removeEventListener("message", handleMessage);
        this.#states.delete(scope);
      }
    };
  }
};

// ../../packages/service-worker/src/owner-binding-port-aware.ts
var PortAwareOwnerBinding = class {
  #window;
  #worker;
  #ownerKinds = /* @__PURE__ */ new Map();
  #signals = /* @__PURE__ */ new WeakMap();
  constructor(opts = {}) {
    this.#window = new FirstWindowOwnerBinding(opts.window);
    this.#worker = new WorkerOwnerBinding(opts.worker);
  }
  async resolveOwner(scope, request, clientId, port) {
    if (clientId === null) {
      const portOwners = await this.#worker.resolvePortOwners(scope, port);
      if (portOwners.kind === "multiple") return null;
      if (portOwners.kind === "unique") {
        this.#ownerKinds.set(portOwners.client.id, "worker");
        return portOwners.client;
      }
    }
    const resolvedWindow = await this.#window.resolveOwner(scope, request, clientId, port);
    const window = resolvedWindow && "type" in resolvedWindow && resolvedWindow.type !== "window" ? null : resolvedWindow;
    if (window) {
      this.#ownerKinds.set(window.id, "window");
      const ownerToken = this.#signals.get(scope)?.window.ownerToken?.(window.id);
      if (ownerToken) {
        const worker = await this.#worker.resolveOwner(scope, request, ownerToken, port);
        if (worker) {
          this.#ownerKinds.set(worker.id, "worker");
          return worker;
        }
      }
    }
    return window;
  }
  subscribeReadiness(scope) {
    const workerSub = this.#worker.subscribeReadiness(scope);
    const windowSub = this.#window.subscribeReadiness(scope);
    this.#signals.set(scope, { worker: workerSub.readiness, window: windowSub.readiness });
    const ownerKinds = this.#ownerKinds;
    let requestIdCounter = 1;
    const pick = (id) => {
      const kind = this.#ownerKinds.get(id);
      if (kind === "worker") return workerSub.readiness;
      if (kind === "window") return windowSub.readiness;
      return null;
    };
    const readiness = {
      isReady: (id) => {
        const signal = pick(id);
        return signal ? signal.isReady(id) : workerSub.readiness.isReady(id) || windowSub.readiness.isReady(id);
      },
      isMismatched: (id) => {
        const signal = pick(id);
        return signal ? signal.isMismatched(id) : workerSub.readiness.isMismatched(id) || windowSub.readiness.isMismatched(id);
      },
      ownerToken: (id) => workerSub.readiness.ownerToken?.(id) ?? windowSub.readiness.ownerToken?.(id),
      waitForReady(id, timeoutMs) {
        const signal = pick(id);
        if (signal) return signal.waitForReady(id, timeoutMs);
        if (workerSub.readiness.isMismatched(id) || windowSub.readiness.isMismatched(id)) {
          return Promise.resolve("mismatch");
        }
        if (workerSub.readiness.isReady(id) || windowSub.readiness.isReady(id)) {
          return Promise.resolve("ready");
        }
        return Promise.race([
          workerSub.readiness.waitForReady(id, timeoutMs),
          windowSub.readiness.waitForReady(id, timeoutMs)
        ]);
      },
      nextRequestId: () => requestIdCounter++
    };
    return {
      readiness,
      teardown: () => {
        workerSub.teardown();
        windowSub.teardown();
        this.#signals.delete(scope);
        ownerKinds.clear();
      }
    };
  }
};

// ../../packages/service-worker/src/route-preview.ts
function previewErrorResponse(body, status) {
  const headers = new Headers();
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  return new Response(body, { status, headers });
}
async function routePreview(scope, request, match, readiness, timeoutMs, clientId, binding) {
  const client = await binding.resolveOwner(scope, request, clientId, match.port);
  if (!client) {
    return previewErrorResponse(`No client to serve preview port ${match.port}`, 503);
  }
  if (readiness.isMismatched(client.id)) {
    return previewErrorResponse("protocol version mismatch", 503);
  }
  const outcome = await readiness.waitForReady(client.id, timeoutMs);
  if (outcome === "mismatch") {
    return previewErrorResponse("protocol version mismatch", 503);
  }
  if (outcome === "gone") {
    return previewErrorResponse(`preview owner ${client.id} departed before handshake`, 503);
  }
  if (outcome === "timeout") {
    if (readiness.isMismatched(client.id)) {
      return previewErrorResponse("protocol version mismatch", 503);
    }
    return previewErrorResponse(`preview-bridge not ready within ${timeoutMs}ms`, 503);
  }
  const channel = new MessageChannel();
  const bodyBytes = request.method === "GET" || request.method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());
  const requestId = readiness.nextRequestId();
  const headers = Object.fromEntries(request.headers);
  if (bodyBytes && !("content-length" in headers) && !("transfer-encoding" in headers)) {
    headers["content-length"] = String(bodyBytes.byteLength);
  }
  const serialised = {
    port: match.port,
    url: `${synthesizePreviewUrl(match.path)}${new URL(request.url).search}`,
    method: request.method,
    headers,
    body: bodyBytes
  };
  return new Promise((resolve) => {
    channel.port1.onmessage = (e) => {
      const data = e.data;
      if ("error" in data) {
        const err = data.error;
        if (typeof err === "object" && err.kind === SW_ERROR_PROTOCOL_VERSION_MISMATCH) {
          console.error("[rifty/service-worker] preview reply protocol mismatch", {
            expected: err.expected,
            got: err.got
          });
          resolve(previewErrorResponse(err.message, 503));
          return;
        }
        resolve(previewErrorResponse(typeof err === "string" ? err : err.message, 502));
        return;
      }
      const headers2 = new Headers(data.headers);
      if (!headers2.has("Cross-Origin-Resource-Policy")) {
        headers2.set("Cross-Origin-Resource-Policy", "cross-origin");
      }
      if (!headers2.has("Cross-Origin-Embedder-Policy")) {
        headers2.set("Cross-Origin-Embedder-Policy", "credentialless");
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
      resolve(new Response(body, { status: data.status, statusText: data.statusText, headers: headers2 }));
    };
    client.postMessage(
      {
        type: SW_PREVIEW_REQUEST,
        requestId,
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
        request: serialised
      },
      [channel.port2]
    );
  });
}

// ../../packages/service-worker/src/preview-bridge.ts
var MAX_PREVIEW_FRAME_CONTEXTS = 256;
function matchPreviewUrl(pathname) {
  const parsed = parsePreviewPath(pathname);
  if (!parsed) return null;
  return { port: parsed.port, path: parsed.rest };
}
function isPreviewFrameRequest(request) {
  return request.mode === "navigate" || request.destination !== "";
}
function isTopLevelPreviewNavigation(request) {
  return request.mode === "navigate" && request.destination === "document";
}
function matchPreviewReferrer(request, origin) {
  if (!request.referrer) return null;
  const referrer = new URL(request.referrer);
  if (referrer.origin !== origin) return null;
  return matchPreviewUrl(referrer.pathname);
}
function rememberPreviewFrameContext(contexts, docClients, clientId, context) {
  if (!clientId) return;
  docClients.add(clientId);
  if (contexts.has(clientId)) contexts.delete(clientId);
  contexts.set(clientId, context);
  while (contexts.size > MAX_PREVIEW_FRAME_CONTEXTS) {
    const oldest = contexts.keys().next().value;
    if (oldest === void 0) return;
    contexts.delete(oldest);
  }
}
function getScopeOrigin(scope, requestUrl) {
  const locationOrigin = scope.location?.origin;
  if (locationOrigin) return locationOrigin;
  const registrationScope = scope.registration?.scope;
  if (registrationScope) return new URL(registrationScope).origin;
  return requestUrl.origin;
}
var DEFAULT_READY_TIMEOUT_MS = 3e3;
function createPreviewInterceptor(scope, hooks = {}) {
  const timeoutMs = hooks.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const previewFrameContexts = /* @__PURE__ */ new Map();
  const previewDocumentClients = /* @__PURE__ */ new Set();
  let pruningDocClients = false;
  const prunePreviewDocumentClients = async () => {
    if (pruningDocClients) return;
    pruningDocClients = true;
    try {
      const live = await scope.clients.matchAll({ type: "window", includeUncontrolled: false });
      const liveIds = new Set(live.map((c) => c.id));
      for (const id of previewDocumentClients) {
        if (!liveIds.has(id)) previewDocumentClients.delete(id);
      }
    } finally {
      pruningDocClients = false;
    }
  };
  const binding = hooks.binding ?? new PortAwareOwnerBinding({
    window: {
      ...hooks.resolver !== void 0 ? { resolver: hooks.resolver } : {},
      isUntrustedSource: (id) => previewDocumentClients.has(id)
    }
  });
  const subscription = binding.subscribeReadiness(scope);
  const fetchHandler = (event) => {
    const url = new URL(event.request.url);
    const scopeOrigin = getScopeOrigin(scope, url);
    const sameOrigin = url.origin === scopeOrigin;
    const directMatch = sameOrigin ? matchPreviewUrl(url.pathname) : null;
    const frameRequest = isPreviewFrameRequest(event.request);
    const knownPreviewContext = event.clientId ? previewFrameContexts.get(event.clientId) : void 0;
    const knownPreviewClient = knownPreviewContext !== void 0;
    let match = directMatch;
    let clientId = event.resultingClientId || event.clientId || null;
    if (directMatch && (frameRequest || knownPreviewClient)) {
      const frameClientId = event.resultingClientId || event.clientId || null;
      const createsFrameContext = event.request.mode === "navigate" && frameClientId !== null;
      const context = createsFrameContext ? {
        port: directMatch.port,
        copiedTopLevel: isTopLevelPreviewNavigation(event.request)
      } : knownPreviewContext;
      if (createsFrameContext && context) {
        rememberPreviewFrameContext(
          previewFrameContexts,
          previewDocumentClients,
          frameClientId,
          context
        );
      }
      clientId = context ? context.copiedTopLevel ? null : "" : null;
    } else if (!directMatch && sameOrigin) {
      const frameClientId = event.clientId || null;
      let context = frameClientId ? previewFrameContexts.get(frameClientId) : void 0;
      let port = context?.port;
      if (port === void 0) {
        port = matchPreviewReferrer(event.request, scopeOrigin)?.port;
        if (port !== void 0 && frameClientId) {
          context = { port, copiedTopLevel: false };
          rememberPreviewFrameContext(
            previewFrameContexts,
            previewDocumentClients,
            frameClientId,
            context
          );
        }
      }
      if (port === void 0) return;
      const nextFrameClientId = event.resultingClientId || null;
      if (nextFrameClientId) {
        rememberPreviewFrameContext(
          previewFrameContexts,
          previewDocumentClients,
          nextFrameClientId,
          context ?? { port, copiedTopLevel: false }
        );
      }
      match = { port, path: url.pathname };
      clientId = context?.copiedTopLevel ? null : "";
    }
    if (previewDocumentClients.size > MAX_PREVIEW_FRAME_CONTEXTS) {
      void prunePreviewDocumentClients();
    }
    if (!match) return;
    event.respondWith(
      routePreview(
        scope,
        event.request,
        match,
        subscription.readiness,
        timeoutMs,
        clientId,
        binding
      )
    );
  };
  scope.addEventListener("fetch", fetchHandler);
  return {
    teardown() {
      scope.removeEventListener("fetch", fetchHandler);
      subscription.teardown();
    }
  };
}
function installPreviewInterceptor(scope) {
  const handle = createPreviewInterceptor(scope);
  return () => handle.teardown();
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
  const frameOk = data.frameVersion === SW_FRAME_VERSION;
  const routingOk = data.routingVersion === SW_ROUTING_VERSION;
  if (!frameOk || !routingOk) {
    if (!pingMismatchWarned.has(clientId)) {
      pingMismatchWarned.add(clientId);
      const drifted = [];
      if (!frameOk) drifted.push("frame");
      if (!routingOk) drifted.push("routing");
      console.warn(
        `[rifty/service-worker] ping protocol version mismatch from ${clientId} (${drifted.join(
          "+"
        )}): got frame=${String(data.frameVersion)} routing=${String(
          data.routingVersion
        )}, want frame=${SW_FRAME_VERSION} routing=${SW_ROUTING_VERSION}`
      );
    }
    return;
  }
  event.source?.postMessage({
    type: SW_PONG,
    frameVersion: SW_FRAME_VERSION,
    routingVersion: SW_ROUTING_VERSION,
    from: "service-worker"
  });
});
installPreviewInterceptor(self);
