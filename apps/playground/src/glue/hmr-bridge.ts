/**
 * Cross-realm HMR bridge — ADR-0017 phase 1 acceptance.
 *
 * Hosts the ordinary `@riftydev/net` WebSocketServer and ships an inlined
 * browser WebSocket bridge. Replaces native HMR WebSocket hops that can't
 * cross page/iframe/worker realms (no real TCP, no SW interception for WS
 * upgrade).
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
 * the net bridge crosses the page↔iframe (and worker↔iframe) realm boundary
 * instead. At M11 A-026 Vite moves fully into a Worker realm — the iframe keeps
 * the same WS URL, just gets messages from a different sender, so that
 * migration is a realm swap, not a routing rewrite.
 *
 * Server side: {@link setupHmrBridge} owns a token-scoped WS URL for simple
 * broadcasters, while {@link createViteHmrBridgeChannel} exposes the Vite
 * `server.hmr.channels` shape. Client side (iframe): an inlined generic
 * `window.WebSocket` bridge from `@riftydev/net` routes browser constructors
 * to the same server surface.
 *
 * Adapter discipline: no Solid signals here (D-002); caller-driven lifecycle.
 * Doesn't depend on Vite types — the Vite plugin/channel are structural.
 */

import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import {
  type WebSocketConnection,
  WebSocketServer,
  type WsMessage,
  webSocketBridgeClientScript,
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
 * `token`. Exposed because the inlined client needs the same URL.
 */
export function hmrBridgeUrl(port: number, token?: string): string {
  const suffix = token ? `/${encodeURIComponent(token)}` : '';
  return `ws://${PREVIEW_LOCAL_HOST}:${port}/__hmr${suffix}`;
}

/**
 * Inline HMR client script the iframe loads for the mini-dev server. It first
 * installs the generic browser WebSocket bridge, then opens an ordinary
 * `WebSocket` to the token-scoped HMR URL and reloads on mini-dev updates.
 */
export function hmrClientScript(port: number, token?: string): string {
  const url = hmrBridgeUrl(port, token);
  return `${webSocketBridgeClientScript({
    bridgeHosts: [PREVIEW_LOCAL_HOST],
    instrumentation: {
      eventPrefix: 'rifty:hmr',
      openFlag: '__riftyHmrOpen',
      lastMessageFlag: '__riftyHmrLastMessage',
    },
  })}
(function () {
  var socket = new WebSocket(${JSON.stringify(url)});
  function onPayload(payload) {
    try {
      if (typeof payload === 'string') payload = JSON.parse(payload);
    } catch (_) {}
    // Mini-dev default: reload on update. Real Vite uses viteHmrClientScript.
    if (payload && payload.type === 'update') {
      location.reload();
    }
  }
  socket.addEventListener('message', function (e) {
    onPayload(e.data);
  });
})();`;
}

/**
 * Inline transport shim for Vite's real `@vite/client`.
 *
 * Vite still owns HMR payload semantics; this installs the generic
 * `window.WebSocket` bridge before `@vite/client` creates its socket.
 */
export function viteHmrClientScript(port: number, token?: string): string {
  const url = hmrBridgeUrl(port, token);
  return `${webSocketBridgeClientScript({
    bridgeHosts: [PREVIEW_LOCAL_HOST],
    instrumentation: {
      eventPrefix: 'rifty:hmr',
      openFlag: '__riftyHmrOpen',
      lastMessageFlag: '__riftyHmrLastMessage',
    },
  })}
try { window.__riftyHmrBridgeUrl = ${JSON.stringify(url)}; } catch (_) {}`;
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
   * `WebSocketServer` `WsMessage` shape — string / `Uint8Array` / `ArrayBuffer`;
   * callers pre-stringify to match Node's `WebSocket.send(string)`.
   */
  broadcast(payload: WsMessage): void;
  /** Tear down the bridge — closes every accepted connection. */
  close(): void;
}

export interface SetupHmrBridgeOptions {
  /** Dev server port; selects the WS listener and bridge discovery channel. */
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
  const server = new WebSocketServer({
    host: PREVIEW_LOCAL_HOST,
    port: opts.port,
    path: new URL(url).pathname,
  });
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
  const server = new WebSocketServer({
    host: PREVIEW_LOCAL_HOST,
    port: opts.port,
    path: new URL(url).pathname,
  });
  const listeners = new Map<string, Set<ViteHmrChannelListener>>();
  const sockets = new Set<WebSocketConnection>();
  const clients = new WeakMap<WebSocketConnection, ViteHmrChannelClient>();
  let bufferedError: ViteHmrPayload | null = null;

  const emit = (event: string, data?: unknown, client?: ViteHmrChannelClient): void => {
    const eventListeners = listeners.get(event);
    if (!eventListeners) return;
    for (const listener of [...eventListeners]) listener(data, client);
  };

  const clientFor = (socket: WebSocketConnection): ViteHmrChannelClient => {
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
    const socket = conn as WebSocketConnection;
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
