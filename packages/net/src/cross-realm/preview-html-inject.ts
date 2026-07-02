/**
 * Generic preview-frame WebSocket bridge injection (ADR-0189).
 *
 * Every `text/html` response crossing the preview-port bridge gets the
 * self-contained `window.WebSocket` patch head-prepended, so ANY dev tool's
 * stock WS client (vite HMR, webpack HMR, socket.io) reaches the guest server
 * — no per-tool plugin. The script remaps loopback/current-origin WS URLs to
 * the guest port derived from the iframe's `/preview/<port>/` prefix.
 */

import { webSocketBridgeClientScript } from '../ws/browser-client-script.ts';

/** Idempotence marker attribute on the injected script tag. */
export const PREVIEW_WS_BRIDGE_MARKER = 'data-rifty-ws-bridge';

let cachedTag: string | null = null;

function bridgeScriptTag(): string {
  if (cachedTag === null) {
    const script = webSocketBridgeClientScript({
      previewPortFromPath: true,
      // Observability hooks (window flags + CustomEvents) for e2e/self-tests;
      // no behavioral effect on the bridged sockets.
      instrumentation: {
        eventPrefix: 'rifty:ws',
        openFlag: '__riftyWsBridgeOpen',
        lastMessageFlag: '__riftyWsBridgeLastMessage',
      },
    });
    cachedTag = `<script ${PREVIEW_WS_BRIDGE_MARKER}>${script}</script>`;
  }
  return cachedTag;
}

/**
 * Head-prepend the bridge script into an HTML document (buffered v1 — no
 * streaming rewrite, ADR-0189). Marker-guarded: an already-injected document
 * is returned unchanged. Falls back to after-`<html>` / document-prefix when
 * the tag is absent — the patch must land before any framework client script.
 */
export function injectPreviewWebSocketBridge(html: string): string {
  if (html.includes(PREVIEW_WS_BRIDGE_MARKER)) return html;
  const tag = bridgeScriptTag();
  const headOpen = /<head\b[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  return `${tag}${html}`;
}
