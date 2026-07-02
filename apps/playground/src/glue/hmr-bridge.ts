/**
 * Cross-realm HMR bridge — ADR-0017 phase 1; mini-dev's explicit broadcaster
 * half only. The vite plugin/client-script half died with ADR-0189: the
 * cross-realm preview path injects the generic `window.WebSocket` bridge into
 * every text/html response, and stock vite HMR (native `server.ws` on
 * `http.Server.on('upgrade')`) rides it — no per-tool glue.
 *
 * Server side: {@link setupHmrBridge} owns a token-scoped WS URL for simple
 * broadcasters (mini-dev). Client side (iframe): {@link hmrClientScript}
 * inlines the generic bridge + a reload-on-update listener.
 *
 * Adapter discipline: no Solid signals here (D-002); caller-driven lifecycle.
 */

import { PREVIEW_LOCAL_HOST } from '@riftydev/io';
import { WebSocketServer, type WsMessage, webSocketBridgeClientScript } from '@riftydev/net';

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
    // Mini-dev default: reload on update. Real Vite rides the generic
    // preview-path injection (ADR-0189), not this script.
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
