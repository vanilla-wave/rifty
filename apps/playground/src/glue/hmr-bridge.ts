/**
 * Cross-realm HMR bridge — ADR-0017 phase 1 acceptance.
 *
 * Hosts a {@link BridgedWebSocketServer} on the playground page realm and ships
 * a tiny inlined client (`hmrClientScript`) that the preview iframe can load
 * to receive HMR updates over `BroadcastChannel`. The bridge replaces the
 * browser-native `WebSocket` path that Vite's HMR client would otherwise use,
 * which cannot cross the page ↔ iframe realm boundary (no real TCP, no SW
 * interception for the WS upgrade).
 *
 * **Dev-mode vs real-Vite asymmetry (follow-ups doc item #19).** Two HMR
 * paths coexist intentionally today:
 *   - **Real-Vite mode** broadcasts through this bridge — Vite hands its
 *     HMR plugin a `BridgedWebSocketServer` and the iframe loads the inline
 *     client.
 *   - **Dev mode** (the in-realm mini Vite under `examples/vite-like-dev`)
 *     uses its own internal HMR client that reads file-change events from
 *     its own `WebSocketServer` instance directly. It does not route
 *     through this bridge.
 *
 * The asymmetry is acceptable until A-026 (M11) moves Vite into a worker
 * realm — at that point dev mode and real-Vite both have to traverse a
 * realm boundary and unifying them through this bridge becomes free.
 * Readers who expect parity today: there is none; the bridge is currently
 * the real-Vite-only HMR transport.
 *
 * Why a bridge at M10 (before A-026):
 *   - Today Vite runs in the page realm and the preview iframe is a child
 *     realm; even though Vite is in the same JS realm as the playground UI,
 *     the iframe's native `WebSocket` cannot reach an in-process
 *     `WebSocketServer`. Without this bridge HMR would only ever work if we
 *     went over real TCP, which we deliberately do not.
 *   - At M11 A-026 Vite moves into a kernel-spawned Worker realm and the
 *     iframe still wants to be told about file changes. Wiring the bridge
 *     *now* means A-026 is a realm swap, not a routing rewrite — the iframe
 *     keeps using the same `BroadcastChannel` name, just gets its messages
 *     from a different sender.
 *
 * Realm boundaries:
 *   - **Server side** (page realm): {@link setupHmrBridge} owns a
 *     `BridgedWebSocketServer` that listens on
 *     `ws://preview.local:<port>/__hmr`. The page realm code calls
 *     `broadcast(...)` from a file-watcher hook to push HMR messages to
 *     subscribers.
 *   - **Client side** (preview iframe): the iframe loads a script that opens
 *     a `BroadcastChannel` with the same channel name (derived through
 *     {@link channelNameFor}) and speaks the same `open`/`open-ack`/`msg`
 *     wire protocol. The client is intentionally vanilla JS — no
 *     `@rifty/net` import — so it can be injected directly into the served
 *     HTML without bundling.
 *
 * Adapter discipline:
 *   - No Solid signals here (D-002). Caller-driven lifecycle through
 *     `setupHmrBridge` → `close()`. The Solid layer in `realVite.ts` owns
 *     the lifetime.
 *   - Doesn't depend on Vite types — exposes a Vite-shaped plugin
 *     (`createHmrBridgeVitePlugin`) that callers can include in their
 *     `plugins: [...]` list with the same minimal `transformIndexHtml`
 *     contract Vite already uses.
 */

import { BridgedWebSocketServer, type WsMessage, channelNameFor } from '@rifty/net';

/**
 * Build the WS URL the bridge listens on for a given dev server `port`.
 * Exposed because the inlined client script also needs the same URL — keep
 * one source of truth so the server and client agree on the
 * `BroadcastChannel` name.
 */
export function hmrBridgeUrl(port: number): string {
  return `ws://preview.local:${port}/__hmr`;
}

/**
 * Build the inline HMR client script the iframe loads. The returned string
 * is a self-contained `<script>` body that uses `BroadcastChannel` directly
 * to mirror {@link BridgedWebSocket}'s wire protocol — see `bridge.ts`.
 *
 * The script:
 *   - opens the channel and sends `{ type: 'open', cid }`
 *   - waits for `{ type: 'open-ack' }`
 *   - listens for `{ type: 'msg', data }` and dispatches to the iframe
 *     window as a `riftyHmrUpdate` `CustomEvent` (consumer-specific logic
 *     lives in user code or a higher-level plugin — kept generic here)
 *   - on `{ type: 'update' }` HMR payload, reloads the iframe as a default
 *     fallback (matches the same naive behaviour as
 *     `@rifty-examples/vite-like-dev`'s HMR client).
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
  ch.addEventListener('message', function (e) {
    var f = e.data;
    if (!f || f.cid !== cid) return;
    if (f.type === 'open-ack') {
      open = true;
      try { window.dispatchEvent(new Event('rifty:hmr:open')); } catch (_) {}
      return;
    }
    if (f.type === 'msg' && open) {
      var payload = f.data;
      try {
        if (typeof payload === 'string') payload = JSON.parse(payload);
      } catch (_) {}
      try {
        window.dispatchEvent(new CustomEvent('rifty:hmr:message', { detail: payload }));
      } catch (_) {}
      // Naive default: any update message reloads. Full ESM HMR is out of
      // scope for the bridge — that's a higher-level concern (M12+).
      if (payload && payload.type === 'update') {
        location.reload();
      }
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
   * Broadcast an HMR payload to every connected iframe HMR client. Callers
   * pre-stringify if they want to share Node's `WebSocket.send(string)`
   * shape; the bridge accepts the underlying `BridgedWebSocketServer`
   * `WsMessage` shape — string / `Uint8Array` / `ArrayBuffer`.
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
 * Create the page-realm side of the HMR bridge. Idempotent at the
 * channel-name level — calling twice with the same `port` is a programmer
 * error (the second call's `BridgedWebSocketServer` will see open frames
 * from the first server's clients and reply, causing duplicate `open-ack`s).
 * Callers must `close()` before re-creating.
 */
export function setupHmrBridge(opts: SetupHmrBridgeOptions): HmrBridgeHandle {
  const url = hmrBridgeUrl(opts.port);
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

/**
 * Minimal shape we need from a Vite plugin object. We don't import Vite's
 * types directly here because `realVite.ts` keeps Vite's full type surface
 * out of the playground typecheck pass; the plugin contract is small enough
 * to declare structurally.
 *
 * The actual Vite plugin runtime cares only about `name` + the hooks we
 * implement — extra structural members are ignored.
 */
export interface HmrBridgeVitePlugin {
  readonly name: string;
  transformIndexHtml(html: string): string;
}

/**
 * Vite plugin that injects {@link hmrClientScript} into the served
 * `index.html`. The script tag is inserted just before `</body>` so it runs
 * after the page body parses but before any deferred user scripts that may
 * register `rifty:hmr:message` listeners. Idempotent: the plugin
 * deduplicates by attribute marker so reload cycles don't stack copies.
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
