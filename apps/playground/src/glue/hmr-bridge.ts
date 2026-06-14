/**
 * Cross-realm HMR bridge — ADR-0017 phase 1 acceptance.
 *
 * Hosts a {@link BridgedWebSocketServer} and ships inlined iframe transports
 * over `BroadcastChannel`. Replaces native HMR WebSocket hops that can't cross
 * page/iframe/worker realms (no real TCP, no SW interception for WS upgrade).
 *
 * Both HMR consumers route through this bridge: real-Vite mode (worker realm)
 * and dev mode (in-realm mini Vite under `examples/vite-like-dev`, via its
 * pluggable `hmr` transport — see `devMode.ts`). Dev mode formerly used its own
 * native-`WebSocket` client against its in-process `WebSocketServer`, which the
 * preview iframe (a separate realm) could never reach — leaving dev preview
 * non-live. Real-Vite uses Vite's native HMR payloads over
 * {@link createViteHmrBridgeChannel}; mini-dev keeps its simple reload client.
 *
 * Why a bridge at all: the iframe's native `WebSocket` can't reach an in-process
 * `WebSocketServer` (no real TCP, no SW interception for the WS upgrade);
 * `BroadcastChannel` crosses the page↔iframe (and worker↔iframe) realm boundary
 * instead. At M11 A-026 Vite moves fully into a Worker realm — the iframe keeps
 * the same `BroadcastChannel` name, just gets messages from a different sender,
 * so that migration is a realm swap, not a routing rewrite.
 *
 * Server side: {@link setupHmrBridge} owns a token-scoped bridge URL for
 * simple broadcasters, while {@link createViteHmrBridgeChannel} exposes the
 * Vite `server.hmr.channels` shape. Client side (iframe): an inlined script
 * opens the same `BroadcastChannel` (via {@link channelNameFor}) and speaks the
 * bridge `open`/`open-ack`/`msg` protocol.
 * Client is vanilla JS — no `@riftydev/net` import — so it can be injected into
 * served HTML without bundling.
 *
 * Adapter discipline: no Solid signals here (D-002); caller-driven lifecycle.
 * Doesn't depend on Vite types — the Vite plugin/channel are structural.
 */

import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import {
  type BridgedWebSocketConnection,
  BridgedWebSocketServer,
  type WsMessage,
  channelNameFor,
} from '@riftydev/net';

/**
 * Per-server nonce for the HMR bridge URL. This is not a sandbox boundary —
 * the iframe page can read its injected script — but it keeps unrelated
 * same-origin realms from joining a predictable port-only channel.
 */
export function createHmrBridgeToken(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  return `hmr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * WS URL the bridge listens on for a given `port` and optional per-server
 * `token`. Exposed because the inlined client needs the same URL — one source
 * of truth so server and client agree on the `BroadcastChannel` name.
 */
export function hmrBridgeUrl(port: number, token?: string): string {
  const suffix = token ? `/${encodeURIComponent(token)}` : '';
  return `ws://${PREVIEW_LOCAL_HOST}:${port}/__hmr${suffix}`;
}

/**
 * Inline HMR client script the iframe loads — a self-contained `<script>` body
 * using `BroadcastChannel` directly to mirror {@link BridgedWebSocket}'s wire
 * protocol (see `bridge.ts`): opens the channel, waits for `open-ack`, dispatches
 * `msg` payloads as `rifty:hmr:message` events, and reloads on an `update`
 * payload (naive default, matching `@rifty-examples/vite-like-dev`).
 *
 * Kept under 1 KiB so callers can inline it without worrying about budget.
 */
export function hmrClientScript(port: number, token?: string): string {
  const channelName = channelNameFor(hmrBridgeUrl(port, token));
  return `(function () {
  if (typeof BroadcastChannel === 'undefined') return;
  var ch = new BroadcastChannel(${JSON.stringify(channelName)});
  var cid = 'iframe-' + Math.random().toString(36).slice(2, 10);
  var open = false;
  function onPayload(payload) {
    try {
      if (typeof payload === 'string') payload = JSON.parse(payload);
    } catch (_) {}
    try {
      window.dispatchEvent(new CustomEvent('rifty:hmr:message', { detail: payload }));
    } catch (_) {}
    try { window.__riftyHmrLastMessage = payload; } catch (_) {}
    // Mini-dev default: reload on update. Real Vite uses viteHmrClientScript.
    if (payload && payload.type === 'update') {
      location.reload();
    }
  }
  ch.addEventListener('message', function (e) {
    var f = e.data;
    if (!f) return;
    if (f.cid !== cid) return;
    if (f.type === 'open-ack') {
      open = true;
      try { window.__riftyHmrOpen = true; } catch (_) {}
      try { window.dispatchEvent(new Event('rifty:hmr:open')); } catch (_) {}
      return;
    }
    if (f.type === 'msg' && open) {
      onPayload(f.data);
      return;
    }
    if (f.type === 'close' && f.from === 'server') {
      open = false;
      try { ch.close(); } catch (_) {}
    }
  });
  ch.postMessage({ type: 'open', cid: cid });
})();`;
}

/**
 * Inline transport shim for Vite's real `@vite/client`.
 *
 * Vite 5 creates `new WebSocket(url, "vite-hmr")` and then handles `connected`,
 * `update`, `full-reload`, `prune`, and `error` payloads itself. This shim only
 * replaces that HMR socket with the rifty BroadcastChannel bridge; it does not
 * interpret update payloads or reload the page.
 */
export function viteHmrClientScript(port: number, token?: string): string {
  const channelName = channelNameFor(hmrBridgeUrl(port, token));
  return `(function () {
  if (typeof BroadcastChannel === 'undefined') return;
  if (window.__riftyViteHmrBridgeInstalled) return;
  window.__riftyViteHmrBridgeInstalled = true;
  var NativeWebSocket = window.WebSocket;
  var channelName = ${JSON.stringify(channelName)};
  function isViteHmrProtocol(protocols) {
    if (protocols === 'vite-hmr') return true;
    return Array.isArray(protocols) && protocols.indexOf('vite-hmr') !== -1;
  }
  function makeCloseEvent(code, reason, wasClean) {
    try {
      return new CloseEvent('close', { code: code, reason: reason, wasClean: wasClean });
    } catch (_) {
      var ev = new Event('close');
      ev.code = code;
      ev.reason = reason;
      ev.wasClean = wasClean;
      return ev;
    }
  }
  class RiftyViteHmrWebSocket extends EventTarget {
    constructor(url, protocols) {
      if (!isViteHmrProtocol(protocols)) {
        if (!NativeWebSocket) throw new Error('Native WebSocket is not available');
        return new NativeWebSocket(url, protocols);
      }
      super();
      this.url = String(url);
      this.protocol = 'vite-hmr';
      this.extensions = '';
      this.binaryType = 'blob';
      this.CONNECTING = RiftyViteHmrWebSocket.CONNECTING;
      this.OPEN = RiftyViteHmrWebSocket.OPEN;
      this.CLOSING = RiftyViteHmrWebSocket.CLOSING;
      this.CLOSED = RiftyViteHmrWebSocket.CLOSED;
      this.readyState = RiftyViteHmrWebSocket.CONNECTING;
      this.__cid = 'vite-' + Math.random().toString(36).slice(2, 10);
      this.__channel = new BroadcastChannel(channelName);
      this.__connectTimer = setTimeout(() => {
        if (this.readyState !== RiftyViteHmrWebSocket.CONNECTING) return;
        this.readyState = RiftyViteHmrWebSocket.CLOSED;
        this.dispatchEvent(new Event('error'));
        this.dispatchEvent(makeCloseEvent(1006, 'connection refused', false));
        this.__cleanup();
      }, 1000);
      this.__channel.addEventListener('message', (e) => this.__onMessage(e));
      this.__channel.postMessage({ type: 'open', cid: this.__cid });
    }
    __onMessage(e) {
      var f = e.data;
      if (!f || f.cid !== this.__cid) return;
      if (f.type === 'open-ack' && this.readyState === RiftyViteHmrWebSocket.CONNECTING) {
        clearTimeout(this.__connectTimer);
        this.readyState = RiftyViteHmrWebSocket.OPEN;
        window.__riftyHmrOpen = true;
        try { window.dispatchEvent(new Event('rifty:hmr:open')); } catch (_) {}
        this.dispatchEvent(new Event('open'));
        return;
      }
      if (f.type === 'msg' && this.readyState === RiftyViteHmrWebSocket.OPEN) {
        var data = f.data;
        try {
          var parsed = typeof data === 'string' ? JSON.parse(data) : data;
          window.__riftyHmrLastMessage = parsed;
          window.dispatchEvent(new CustomEvent('rifty:hmr:message', { detail: parsed }));
        } catch (_) {}
        this.dispatchEvent(new MessageEvent('message', { data: data }));
        return;
      }
      if (f.type === 'close' && f.from === 'server') {
        if (this.readyState === RiftyViteHmrWebSocket.CLOSED) return;
        this.readyState = RiftyViteHmrWebSocket.CLOSED;
        this.dispatchEvent(makeCloseEvent(f.code || 1000, f.reason || '', true));
        this.__cleanup();
      }
    }
    send(data) {
      if (this.readyState !== RiftyViteHmrWebSocket.OPEN) return;
      this.__channel.postMessage({ type: 'msg', cid: this.__cid, data: data });
    }
    close(code, reason) {
      if (
        this.readyState === RiftyViteHmrWebSocket.CLOSED ||
        this.readyState === RiftyViteHmrWebSocket.CLOSING
      ) return;
      this.readyState = RiftyViteHmrWebSocket.CLOSING;
      this.__channel.postMessage({
        type: 'close',
        cid: this.__cid,
        code: code || 1000,
        reason: reason || '',
        from: 'client'
      });
      this.readyState = RiftyViteHmrWebSocket.CLOSED;
      this.dispatchEvent(makeCloseEvent(code || 1000, reason || '', true));
      this.__cleanup();
    }
    __cleanup() {
      clearTimeout(this.__connectTimer);
      try { this.__channel.close(); } catch (_) {}
    }
  }
  RiftyViteHmrWebSocket.CONNECTING = NativeWebSocket ? NativeWebSocket.CONNECTING : 0;
  RiftyViteHmrWebSocket.OPEN = NativeWebSocket ? NativeWebSocket.OPEN : 1;
  RiftyViteHmrWebSocket.CLOSING = NativeWebSocket ? NativeWebSocket.CLOSING : 2;
  RiftyViteHmrWebSocket.CLOSED = NativeWebSocket ? NativeWebSocket.CLOSED : 3;
  window.WebSocket = RiftyViteHmrWebSocket;
})();`;
}

/**
 * Public handle returned by {@link setupHmrBridge}. Owners broadcast HMR
 * payloads through `broadcast()` and tear the server down with `close()`.
 */
export interface HmrBridgeHandle {
  /** The WS-shaped URL the server listens on (= the iframe HMR client target). */
  readonly url: string;
  /**
   * Broadcast an HMR payload to every connected iframe client. Accepts the
   * `BridgedWebSocketServer` `WsMessage` shape — string / `Uint8Array` /
   * `ArrayBuffer`; callers pre-stringify to match Node's `WebSocket.send(string)`.
   */
  broadcast(payload: WsMessage): void;
  /** Tear down the bridge — closes every accepted connection. */
  close(): void;
}

export interface SetupHmrBridgeOptions {
  /** Dev server port; selects the per-port `BroadcastChannel` name. */
  readonly port: number;
  /** Per-server nonce; prevents unrelated same-origin code from guessing the channel. */
  readonly token?: string;
}

/**
 * Create the page-realm side of the HMR bridge. Calling twice with the same
 * `port` is a programmer error: the second server sees open frames from the
 * first's clients and replies, causing duplicate `open-ack`s. `close()` before
 * re-creating.
 */
export function setupHmrBridge(opts: SetupHmrBridgeOptions): HmrBridgeHandle {
  const url = hmrBridgeUrl(opts.port, opts.token);
  const server = new BridgedWebSocketServer(url);
  return {
    url,
    broadcast(payload: WsMessage): void {
      server.broadcast(payload);
    },
    close(): void {
      server.close();
    },
  };
}

export interface ViteHmrPayload {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface ViteHmrChannelClient {
  send(payload: ViteHmrPayload | string, data?: unknown): void;
}

export type ViteHmrChannelListener = (data?: unknown, client?: ViteHmrChannelClient) => void;

export interface ViteHmrBridgeChannel {
  readonly name: string;
  readonly url: string;
  readonly clients: ReadonlySet<ViteHmrChannelClient>;
  listen(): void;
  on(event: string, listener: ViteHmrChannelListener): void;
  off(event: string, listener: ViteHmrChannelListener): void;
  send(payload: ViteHmrPayload | string, data?: unknown): void;
  close(): Promise<void>;
}

const viteHmrTextDecoder = new TextDecoder();

function wsMessageToString(data: WsMessage): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return viteHmrTextDecoder.decode(new Uint8Array(data));
  return viteHmrTextDecoder.decode(data);
}

function toVitePayload(payload: ViteHmrPayload | string, data?: unknown): ViteHmrPayload {
  if (typeof payload === 'string') return { type: 'custom', event: payload, data };
  return payload;
}

function stringifyVitePayload(payload: ViteHmrPayload | string, data?: unknown): string {
  return JSON.stringify(toVitePayload(payload, data));
}

function isCustomVitePayload(payload: unknown): payload is {
  readonly type: 'custom';
  readonly event: string;
  readonly data?: unknown;
} {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as { readonly type?: unknown; readonly event?: unknown };
  return candidate.type === 'custom' && typeof candidate.event === 'string';
}

/**
 * Vite `server.hmr.channels` adapter backed by the rifty cross-realm bridge.
 * Vite owns module invalidation and HMR payload generation; this channel only
 * carries those real payloads between the Worker dev server and the iframe.
 */
export function createViteHmrBridgeChannel(opts: SetupHmrBridgeOptions): ViteHmrBridgeChannel {
  const url = hmrBridgeUrl(opts.port, opts.token);
  const server = new BridgedWebSocketServer(url);
  const listeners = new Map<string, Set<ViteHmrChannelListener>>();
  const sockets = new Set<BridgedWebSocketConnection>();
  const clients = new WeakMap<BridgedWebSocketConnection, ViteHmrChannelClient>();
  let bufferedError: ViteHmrPayload | null = null;

  const emit = (event: string, data?: unknown, client?: ViteHmrChannelClient): void => {
    const eventListeners = listeners.get(event);
    if (!eventListeners) return;
    for (const listener of [...eventListeners]) listener(data, client);
  };

  const clientFor = (socket: BridgedWebSocketConnection): ViteHmrChannelClient => {
    const existing = clients.get(socket);
    if (existing) return existing;
    const client: ViteHmrChannelClient = {
      send(payload: ViteHmrPayload | string, data?: unknown): void {
        socket.send(stringifyVitePayload(payload, data));
      },
    };
    clients.set(socket, client);
    return client;
  };

  server.on('connection', (conn) => {
    const socket = conn as BridgedWebSocketConnection;
    const client = clientFor(socket);
    sockets.add(socket);
    socket.on('message', (raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(wsMessageToString(raw as WsMessage));
      } catch {
        return;
      }
      if (isCustomVitePayload(payload)) {
        emit(payload.event, payload.data, client);
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
    });
    client.send({ type: 'connected' });
    if (bufferedError) {
      client.send(bufferedError);
      bufferedError = null;
    }
    emit('connection', undefined, client);
  });

  return {
    name: 'rifty-vite-hmr',
    url,
    get clients(): ReadonlySet<ViteHmrChannelClient> {
      return new Set([...sockets].map((socket) => clientFor(socket)));
    },
    listen(): void {},
    on(event: string, listener: ViteHmrChannelListener): void {
      let eventListeners = listeners.get(event);
      if (!eventListeners) {
        eventListeners = new Set();
        listeners.set(event, eventListeners);
      }
      eventListeners.add(listener);
    },
    off(event: string, listener: ViteHmrChannelListener): void {
      const eventListeners = listeners.get(event);
      if (!eventListeners) return;
      eventListeners.delete(listener);
      if (eventListeners.size === 0) listeners.delete(event);
    },
    send(payload: ViteHmrPayload | string, data?: unknown): void {
      const vitePayload = toVitePayload(payload, data);
      if (vitePayload.type === 'error' && sockets.size === 0) {
        bufferedError = vitePayload;
        return;
      }
      const message = JSON.stringify(vitePayload);
      for (const socket of sockets) socket.send(message);
    },
    close(): Promise<void> {
      listeners.clear();
      sockets.clear();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Minimal shape we need from a Vite plugin. Declared structurally rather than
 * importing Vite's types — `realVite.ts` keeps Vite's full type surface out of
 * the playground typecheck pass. The runtime cares only about `name` + the hooks
 * we implement.
 */
export interface HmrBridgeVitePlugin {
  readonly name: string;
  transformIndexHtml(html: string): HmrBridgeHtmlTransformResult;
}

export interface HmrBridgeHtmlTag {
  readonly tag: 'script';
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: string;
  readonly injectTo: 'head-prepend';
}

export interface HmrBridgeHtmlTransform {
  readonly html: string;
  readonly tags: readonly HmrBridgeHtmlTag[];
}

export type HmrBridgeHtmlTransformResult = string | HmrBridgeHtmlTransform;

/**
 * Vite plugin that injects {@link viteHmrClientScript} as `head-prepend`.
 * Vite's own dev HTML hook runs before user plugins; this late head-prepend
 * lands before `/@vite/client`, so the WebSocket shim is installed first.
 */
export function createHmrBridgeVitePlugin(opts: SetupHmrBridgeOptions): HmrBridgeVitePlugin {
  const script = viteHmrClientScript(opts.port, opts.token);
  const marker = 'data-rifty-hmr-bridge';
  return {
    name: 'rifty:hmr-bridge',
    transformIndexHtml(html: string): HmrBridgeHtmlTransformResult {
      if (html.includes(marker)) return html;
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { [marker]: '' },
            children: script,
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}
