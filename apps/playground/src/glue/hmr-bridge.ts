/**
 * Cross-realm HMR bridge — ADR-0017 phase 1 acceptance.
 *
 * Hosts a {@link BridgedWebSocketServer} on the page realm and ships an inlined
 * client (`hmrClientScript`) the preview iframe loads to receive HMR updates
 * over `BroadcastChannel`. Replaces the native `WebSocket` path Vite's HMR
 * client would use, which can't cross the page ↔ iframe realm boundary (no real
 * TCP, no SW interception for the WS upgrade).
 *
 * Both HMR consumers route through this bridge: real-Vite mode (worker realm)
 * and dev mode (in-realm mini Vite under `examples/vite-like-dev`, via its
 * pluggable `hmr` transport — see `devMode.ts`). Dev mode formerly used its own
 * native-`WebSocket` client against its in-process `WebSocketServer`, which the
 * preview iframe (a separate realm) could never reach — leaving dev preview
 * non-live. Routing dev mode through this bridge closed that asymmetry; both
 * deliver the same naive `{type:'update'}` → iframe reload.
 *
 * Why a bridge at all: the iframe's native `WebSocket` can't reach an in-process
 * `WebSocketServer` (no real TCP, no SW interception for the WS upgrade);
 * `BroadcastChannel` crosses the page↔iframe (and worker↔iframe) realm boundary
 * instead. At M11 A-026 Vite moves fully into a Worker realm — the iframe keeps
 * the same `BroadcastChannel` name, just gets messages from a different sender,
 * so that migration is a realm swap, not a routing rewrite.
 *
 * Server side (page realm): {@link setupHmrBridge} owns a
 * `BridgedWebSocketServer` on `ws://preview.local:<port>/__hmr`; callers
 * `broadcast(...)` from a file-watcher hook. Client side (iframe): loads a
 * script opening a `BroadcastChannel` of the same name (via
 * {@link channelNameFor}), speaking the same `open`/`open-ack`/`msg` protocol.
 * Client is vanilla JS — no `@riftydev/net` import — so it can be injected into
 * served HTML without bundling.
 *
 * Adapter discipline: no Solid signals here (D-002); caller-driven lifecycle
 * (`realVite.ts` owns lifetime). Doesn't depend on Vite types — exposes a
 * Vite-shaped plugin (`createHmrBridgeVitePlugin`) declared structurally.
 */

import { BridgedWebSocketServer, type WsMessage, channelNameFor } from '@riftydev/net';

/**
 * WS URL the bridge listens on for a given `port`. Exposed because the inlined
 * client needs the same URL — one source of truth so server and client agree on
 * the `BroadcastChannel` name.
 */
export function hmrBridgeUrl(port: number): string {
  return `ws://preview.local:${port}/__hmr`;
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
export function hmrClientScript(port: number): string {
  const channelName = channelNameFor(hmrBridgeUrl(port));
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
    // Naive default: reload on update. Full ESM HMR is out of scope for the
    // bridge — higher-level concern (M12+).
    if (payload && payload.type === 'update') {
      location.reload();
    }
  }
  ch.addEventListener('message', function (e) {
    var f = e.data;
    if (!f) return;
    if (f.type === 'broadcast') {
      onPayload(f.data);
      return;
    }
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
}

/**
 * Create the page-realm side of the HMR bridge. Calling twice with the same
 * `port` is a programmer error: the second server sees open frames from the
 * first's clients and replies, causing duplicate `open-ack`s. `close()` before
 * re-creating.
 */
export function setupHmrBridge(opts: SetupHmrBridgeOptions): HmrBridgeHandle {
  const url = hmrBridgeUrl(opts.port);
  const server = new BridgedWebSocketServer(url);
  const fanout = new BroadcastChannel(channelNameFor(url));
  return {
    url,
    broadcast(payload: WsMessage): void {
      server.broadcast(payload);
      fanout.postMessage({ type: 'broadcast', data: payload });
    },
    close(): void {
      server.close();
      fanout.close();
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
  transformIndexHtml(html: string): string;
}

/**
 * Vite plugin that injects {@link hmrClientScript} into served `index.html`,
 * just before `</body>` so it runs after the body parses but before deferred
 * user scripts that may register `rifty:hmr:message` listeners. Deduplicates by
 * attribute marker so reload cycles don't stack copies.
 */
export function createHmrBridgeVitePlugin(opts: SetupHmrBridgeOptions): HmrBridgeVitePlugin {
  const script = hmrClientScript(opts.port);
  const marker = 'data-rifty-hmr-bridge';
  const injection = `<script ${marker}>${script}</script>`;
  return {
    name: 'rifty:hmr-bridge',
    transformIndexHtml(html: string): string {
      if (html.includes(marker)) return html;
      const idx = html.lastIndexOf('</body>');
      if (idx === -1) return html + injection;
      return html.slice(0, idx) + injection + html.slice(idx);
    },
  };
}
